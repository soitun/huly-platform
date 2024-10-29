/* eslint-disable @typescript-eslint/unbound-method */
import { Analytics } from '@hcengineering/analytics'
import type {
  Branding,
  Class,
  Doc,
  DocumentQuery,
  IndexingUpdateEvent,
  MeasureContext,
  Ref,
  SearchOptions,
  SearchQuery,
  Tx,
  TxWorkspaceEvent,
  WorkspaceId,
  WorkspaceIdWithUrl
} from '@hcengineering/core'
import core, {
  generateId,
  Hierarchy,
  ModelDb,
  systemAccountEmail,
  WorkspaceEvent
} from '@hcengineering/core'
import {
  ContextNameMiddleware,
  DBAdapterInitMiddleware,
  DBAdapterMiddleware,
  DomainFindMiddleware,
  LowLevelMiddleware
} from '@hcengineering/middleware'
import { PlatformError, setMetadata, unknownError } from '@hcengineering/platform'
import serverClientPlugin, { getTransactorEndpoint } from '@hcengineering/server-client'
import serverCore, {
  createContentAdapter,
  createPipeline,
  type FullTextAdapter,
  type MiddlewareCreator,
  type Pipeline,
  type PipelineContext,
  type SessionFindAll,
  type StorageAdapter
} from '@hcengineering/server-core'
import { FullTextIndex, FullTextIndexPipeline, type FulltextDBConfiguration } from '@hcengineering/server-indexer'
import { getConfig } from '@hcengineering/server-pipeline'
import serverToken, { decodeToken, generateToken } from '@hcengineering/server-token'
import cors from '@koa/cors'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import Router from 'koa-router'

class WorkspaceIndexer {
  fulltextAdapter!: FullTextAdapter
  fulltext!: FullTextIndex
  pipeline!: Pipeline

  lastUpdate: number = Date.now()

  static async create (
    ctx: MeasureContext,
    model: Tx[],
    workspace: WorkspaceIdWithUrl,
    dbURL: string,
    conf: FulltextDBConfiguration,
    externalStorage: StorageAdapter
  ): Promise<WorkspaceIndexer> {
    const result = new WorkspaceIndexer()
    const dbConf = getConfig(ctx, dbURL, ctx, {
      disableTriggers: true,
      externalStorage
    })

    const middlewares: MiddlewareCreator[] = [
      LowLevelMiddleware.create,
      ContextNameMiddleware.create,
      DomainFindMiddleware.create,
      DBAdapterInitMiddleware.create,
      DBAdapterMiddleware.create(dbConf)
    ]

    const hierarchy = new Hierarchy()
    const modelDb = new ModelDb(hierarchy)
    for (const tx of model) {
      try {
        hierarchy.tx(tx)
      } catch (err) {
        // Ignore
      }
    }
    modelDb.addTxes(ctx, model, false)

    const context: PipelineContext = {
      workspace,
      branding: null,
      modelDb,
      hierarchy,
      storageAdapter: externalStorage
    }
    result.pipeline = await createPipeline(ctx, middlewares, context)

    const contentAdapter = await ctx.with('create content adapter', {}, (ctx) =>
      createContentAdapter(conf.contentAdapters, conf.defaultContentAdapter, workspace, ctx.newChild('content', {}))
    )
    const findAll: SessionFindAll = (ctx, _class, query, options) => {
      return result.pipeline.findAll(ctx, _class, query, options)
    }
    if (result.pipeline.context.storageAdapter === undefined) {
      throw new PlatformError(unknownError('Storage adapter must be defined'))
    }

    result.fulltextAdapter = await conf.fulltextAdapter.factory(conf.fulltextAdapter.url, workspace, ctx)

    // TODO: Extract storage adapter to context
    const stages =
      result.fulltextAdapter !== undefined && result.fulltextAdapter !== undefined
        ? conf.fulltextAdapter.stages(
          result.fulltextAdapter,
          findAll,
          result.pipeline.context.storageAdapter,
          contentAdapter
        )
        : []

    const defaultAdapter = result.pipeline.context.adapterManager?.getDefaultAdapter()
    if (defaultAdapter === undefined) {
      throw new PlatformError(unknownError('Default adapter should be set'))
    }

    const token = generateToken(systemAccountEmail, workspace)
    const transactorEndpoint = (await getTransactorEndpoint(token, 'internal'))
      .replace('wss://', 'https://')
      .replace('ws://', 'http://')

    const indexer = new FullTextIndexPipeline(
      defaultAdapter,
      stages,
      hierarchy,
      workspace,
      ctx,
      modelDb,
      (ctx: MeasureContext, classes: Ref<Class<Doc>>[]) => {
        ctx.info('broadcast indexing update', { classes, workspace })
        const evt: IndexingUpdateEvent = {
          _class: classes
        }
        const tx: TxWorkspaceEvent = {
          _class: core.class.TxWorkspaceEvent,
          _id: generateId(),
          event: WorkspaceEvent.IndexingUpdate,
          modifiedBy: core.account.System,
          modifiedOn: Date.now(),
          objectSpace: core.space.DerivedTx,
          space: core.space.DerivedTx,
          params: evt
        }
        // Send tx to pipeline
        // TODO: Fix me
        void fetch(transactorEndpoint + `/api/v1/broadcast?token=${token}&workspace=${workspace.name}`, {
          method: 'PUT',
          body: JSON.stringify(tx)
        })
      }
    )
    result.fulltext = new FullTextIndex(
      hierarchy,
      result.fulltextAdapter,
      findAll,
      externalStorage,
      workspace,
      indexer,
      false
    )
    return result
  }

  async close (): Promise<void> {
    await this.fulltext.close()
    await this.fulltextAdapter.close()
    await this.pipeline.close()
  }
}

interface IndexDocuments {
  token: string
  workspace: WorkspaceIdWithUrl
  requests: Tx[]
}

interface FulltextSearch {
  token: string
  workspace: WorkspaceIdWithUrl
  query: SearchQuery
  options: SearchOptions
}

interface Search {
  token: string
  workspace: WorkspaceIdWithUrl
  _classes: Ref<Class<Doc>>[]
  query: DocumentQuery<Doc>
  fullTextLimit: number
}

export function startIndexer (
  ctx: MeasureContext,
  opt: {
    model: Tx[]
    dbURL: string
    config: (workspace: WorkspaceId, branding: Branding | null) => FulltextDBConfiguration
    externalStorage: StorageAdapter
    elasticIndexName: string
    port: number
    serverSecret: string
    accountsUrl: string
  }
): () => void {
  const closeTimeout = 5 * 60 * 1000

  setMetadata(serverToken.metadata.Secret, opt.serverSecret)
  setMetadata(serverCore.metadata.ElasticIndexName, opt.elasticIndexName)
  setMetadata(serverClientPlugin.metadata.Endpoint, opt.accountsUrl)

  const app = new Koa()
  const router = new Router()

  const indexers = new Map<string, WorkspaceIndexer | Promise<WorkspaceIndexer>>()

  const shutdownInterval = setInterval(() => {
    for (const [k, v] of [...indexers.entries()]) {
      if (v instanceof Promise) {
        continue
      }
      if (Date.now() - v.lastUpdate > closeTimeout) {
        indexers.delete(k)
        void v.close()
      }
    }
  }, closeTimeout) // Every 5 minutes we should close unused indexes.

  function getIndexer (ctx: MeasureContext, workspace: WorkspaceIdWithUrl): Promise<WorkspaceIndexer> | WorkspaceIndexer {
    let idx = indexers.get(workspace.name)
    if (idx === undefined) {
      const dbConfig = opt.config(workspace, null)
      idx = WorkspaceIndexer.create(ctx, opt.model, workspace, opt.dbURL, dbConfig, opt.externalStorage)
      indexers.set(workspace.name, idx)
    }
    return idx
  }

  app.use(
    cors({
      credentials: true
    })
  )
  app.use(bodyParser())

  router.put('/api/v1/search', async (req, res) => {
    try {
      const request = req.request.body as Search
      decodeToken(request.token) // Just to be safe

      const indexer = await ctx.withSync('get-indexer', {}, (ctx) => getIndexer(ctx, request.workspace))
      const docs = await ctx.with('search', { workspace: request.workspace.name }, (ctx) =>
        indexer.fulltextAdapter.search(request._classes, request.query, request.fullTextLimit)
      )

      req.body = docs
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })
  router.put('/api/v1/full-text-search', async (req, res) => {
    try {
      const request = req.request.body as FulltextSearch
      decodeToken(request.token) // Just to be safe

      const indexer = await ctx.withSync('get-indexer', {}, (ctx) => getIndexer(ctx, request.workspace))
      const result = await ctx.with('full-text-search', {}, (ctx) => indexer.fulltext.searchFulltext(ctx, request.query, request.options))
      indexer.lastUpdate = Date.now()
      req.body = result
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  router.put('/api/v1/index-documents', async (req, res) => {
    try {
      const request = req.request.body as IndexDocuments
      decodeToken(request.token) // Just to be safe

      const indexer = await ctx.withSync('get-indexer', {}, (ctx) => getIndexer(ctx, request.workspace))
      void ctx.with('index-documents', {}, (ctx) => indexer.fulltext.tx(ctx, request.requests))
      indexer.lastUpdate = Date.now()
      req.body = {}
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  app.use(router.routes()).use(router.allowedMethods())

  const server = app.listen(opt.port, () => {
    console.log(`server started on port ${opt.port}`)
  })

  const close = (): void => {
    clearInterval(shutdownInterval)
    server.close()
  }

  return close
}
