import attachment, { type Attachment } from '@hcengineering/attachment'
import core, {
  type AttachedData,
  type CollaborativeDoc,
  collaborativeDocParse,
  type Data,
  generateId,
  makeCollaborativeDoc,
  type Mixin,
  type Ref,
  SortingOrder,
  type Timestamp,
  type TxOperations,
  type DocumentQuery,
  type Status,
  type Account,
  ClassifierKind
} from '@hcengineering/core'
import { type IntlString } from '@hcengineering/platform'
import { type FileUploader } from './uploader'
import task, {
  createProjectType,
  makeRank,
  type TaskTypeWithFactory,
  type ProjectType,
  type TaskType
} from '@hcengineering/task'
import document, { type Document, type Teamspace, getFirstRank } from '@hcengineering/document'
import { jsonToMarkup, jsonToYDocNoSchema, parseMessageMarkdown, type MarkupNode } from '@hcengineering/text'
import { yDocToBuffer } from '@hcengineering/collaboration'
import { type Person } from '@hcengineering/contact'
import tracker, {
  type Issue,
  type IssueParentInfo,
  IssuePriority,
  type IssueStatus,
  type Project,
  TimeReportDayType
} from '@hcengineering/tracker'
import chunter, { type ChatMessage } from '@hcengineering/chunter'

export interface ImportWorkspace {
  persons?: ImportPerson[]
  projectTypes?: ImportProjectType[]
  spaces?: ImportSpace<ImportDoc>[]
}

export interface ImportPerson {
  name: string
  email: string
}

export interface ImportProjectType {
  name: string
  taskTypes?: ImportTaskType[]
  description?: string
}

export interface ImportTaskType {
  name: string
  statuses: ImportStatus[]
  attributes?: ImportAttribute[]
  description?: string
}

export interface ImportStatus {
  name: string
  description?: string
}

export interface ImportAttribute {
  name: string
  label: string
}

export interface ImportSpace<T extends ImportDoc> {
  class: string
  name: string
  // members?: ImportPerson[] // todo: person vs account

  docs: T[]
}
export interface ImportDoc {
  class: string
  title: string
  descrProvider: () => Promise<string>

  subdocs: ImportDoc[]
}

export interface ImportTeamspace extends ImportSpace<ImportDocument> {
  class: 'document.class.TeamSpace'
}

export interface ImportDocument extends ImportDoc {
  class: 'document.class.Document'
  subdocs: ImportDocument[]
}

export interface ImportProject extends ImportSpace<ImportIssue> {
  class: 'tracker.class.Project'
  identifier: string
  private: boolean
  autoJoin: boolean
  projectType: ImportProjectType
  defaultAssignee?: ImportPerson
  defaultIssueStatus?: ImportStatus
  owners?: ImportPerson[]
  members?: ImportPerson[]
  description?: string
}

export interface ImportIssue extends ImportDoc {
  class: 'tracker.class.Issue'
  taskType: string
  status: ImportStatus
  assignee?: Ref<Person>
  estimation?: number
  remainingTime?: number
  comments?: ImportComment[]
  customAttributes?: Map<string, string>
}

export interface ImportComment {
  text: string
  author?: Ref<Account>// todo: person vs account
  date?: Timestamp
  attachments?: ImportAttachment[]
}

export interface ImportAttachment {
  title: string
  blobProvider: () => Promise<Blob | null>
}

export interface MarkdownPreprocessor {
  process: (json: MarkupNode) => MarkupNode
}

export class WorkspaceImporter {
  private readonly personsByName = new Map<string, Ref<Person>>()
  private readonly issueStatusByName = new Map<string, Ref<IssueStatus>>()
  private readonly projectTypeByName = new Map<string, Ref<ProjectType>>()
  private readonly taskTypeByName = new Map<string, Ref<TaskType>>()

  constructor (
    private readonly client: TxOperations,
    private readonly fileUploader: FileUploader,
    private readonly workspaceData: ImportWorkspace,
    private readonly preprocessor: MarkdownPreprocessor
  ) {}

  public async performImport (): Promise<void> {
    if (this.workspaceData.persons !== undefined) {
      for (const person of this.workspaceData.persons) {
        // todo create people
        this.personsByName.set(person.name, generateId())
      }
    }

    if (this.workspaceData.projectTypes !== undefined) {
      for (const projectType of this.workspaceData.projectTypes) {
        const projectTypeId = await this.importProjectType(projectType)
        this.projectTypeByName.set(projectType.name, projectTypeId)
      }
    }

    if (this.workspaceData.spaces !== undefined) {
      for (const space of this.workspaceData.spaces) {
        if (space.class === 'document.class.TeamSpace') {
          await this.importTeamspace(space as ImportTeamspace)
        } else if (space.class === 'tracker.class.Project') {
          await this.importProject(space as ImportProject)
        }
      }
    }
  }

  async importProjectType (projectType: ImportProjectType): Promise<Ref<ProjectType>> {
    const taskTypes: TaskTypeWithFactory[] = []
    if (projectType.taskTypes !== undefined) {
      for (const taskType of projectType.taskTypes) {
        const taskTypeId = generateId<TaskType>()
        const statuses = taskType.statuses.map((status) => {
          return {
            name: status.name,
            ofAttribute: tracker.attribute.IssueStatus,
            category: task.statusCategory.Active
          }
        })

        // Create target class for custom attributes
        const targetClassId = await this.client.createDoc(core.class.Class, core.space.Model, {
          extends: tracker.class.Issue,
          kind: ClassifierKind.MIXIN,
          label: taskType.name as IntlString
        })

        if (taskType.attributes !== undefined) {
          // Add custom attributes to the target class
          for (const attribute of taskType.attributes) {
            await this.client.createDoc(core.class.Attribute, core.space.Model, {
              name: attribute.name,
              label: attribute.label,
              type: {
                _class: core.class.TypeString,
                label: core.string.String
              },
              attributeOf: targetClassId,
              isCustom: true,
              space: core.space.Model,
              index: 1
            })
          }
        }

        taskTypes.push({
          _id: taskTypeId,
          descriptor: tracker.descriptors.Issue,
          kind: 'both',
          name: taskType.name,
          ofClass: tracker.class.Issue,
          targetClass: targetClassId, // Use the new target class with custom attributes
          statusCategories: [task.statusCategory.Active],
          statusClass: tracker.class.IssueStatus,
          icon: tracker.icon.Issue,
          color: 0,
          allowedAsChildOf: [taskTypeId],
          factory: statuses
        })

        this.taskTypeByName.set(taskType.name, taskTypeId)
      }
    }
    const projectData = {
      name: projectType.name,
      descriptor: tracker.descriptors.ProjectType,
      shortDescription: projectType.description,
      description: '', // Put the description as shortDescription, so the users can see it
      tasks: [],
      roles: 0,
      classic: true
    }
    return await createProjectType(this.client, projectData, taskTypes, generateId())
  }

  async importTeamspace (space: ImportTeamspace): Promise<Ref<Teamspace>> {
    const teamspaceId = await this.createTeamspace(space)
    for (const doc of space.docs) {
      await this.createDocumentsWithSubdocs(doc, document.ids.NoParent, teamspaceId)
    }
    return teamspaceId
  }

  async createDocumentsWithSubdocs (
    doc: ImportDocument,
    parentId: Ref<Document>,
    teamspaceId: Ref<Teamspace>
  ): Promise<Ref<Document>> {
    const documentId = await this.createDocument(doc, parentId, teamspaceId)
    for (const child of doc.subdocs) {
      await this.createDocumentsWithSubdocs(child, documentId, teamspaceId)
    }
    return documentId
  }

  async createTeamspace (space: ImportTeamspace): Promise<Ref<Teamspace>> {
    const teamspaceId = generateId<Teamspace>()
    const data = {
      type: document.spaceType.DefaultTeamspaceType,
      description: 'Imported from Notion',
      title: space.name,
      name: space.name,
      private: false,
      members: [],
      owners: [],
      autoJoin: false,
      archived: false
    }
    await this.client.createDoc(document.class.Teamspace, core.space.Space, data, teamspaceId)
    return teamspaceId
  }

  async createDocument (
    doc: ImportDocument,
    parentId: Ref<Document>,
    teamspaceId: Ref<Teamspace>
  ): Promise<Ref<Document>> {
    const md = await doc.descrProvider()
    const json = parseMessageMarkdown(md, 'image://')
    const processedJson = this.preprocessor.process(json)

    const id = generateId<Document>()
    const collabId = makeCollaborativeDoc(id, 'description')
    const yDoc = jsonToYDocNoSchema(processedJson, 'content')
    const { documentId } = collaborativeDocParse(collabId)
    const buffer = yDocToBuffer(yDoc)

    const form = new FormData()
    const file = new File([new Blob([buffer])], doc.title)
    form.append('file', file, documentId)
    form.append('type', 'application/ydoc')
    form.append('size', buffer.length.toString())
    form.append('name', doc.title)
    form.append('id', id)
    form.append('data', new Blob([buffer])) // ?
    await this.fileUploader(id, form)

    const lastRank = await getFirstRank(this.client, teamspaceId, parentId)
    const rank = makeRank(lastRank, undefined)

    const attachedData: Data<Document> = {
      title: doc.title,
      content: collabId,
      parent: parentId,
      attachments: 0,
      embeddings: 0,
      labels: 0,
      comments: 0,
      references: 0,
      rank
    }

    await this.client.createDoc(document.class.Document, teamspaceId, attachedData, id)
    return id
  }

  async importProject (project: ImportProject): Promise<Ref<Project>> {
    console.log('Create project: ', project.name)
    const projectId = await this.createProject(project)
    console.log('Project created: ' + projectId)

    const hulyProject = await this.client.findOne(tracker.class.Project, { _id: projectId })
    if (hulyProject === undefined) {
      throw new Error('Project not found: ' + projectId)
    }

    for (const issue of project.docs) {
      await this.createIssueWithSubissues(issue, tracker.ids.NoParent, hulyProject, [])
    }
    return projectId
  }

  async createIssueWithSubissues (
    issue: ImportIssue,
    parentId: Ref<Issue>,
    project: Project,
    parentsInfo: IssueParentInfo[]
  ): Promise<Ref<Issue>> {
    console.log('Create issue: ', issue.title)
    const issueId = await this.createIssue(issue, project, parentId, parentsInfo)
    console.log('Issue created: ', issueId)

    if (issue.subdocs.length > 0) {
      const parentsInfoEx = [
        {
          parentId: issueId.id,
          parentTitle: issue.title,
          space: project._id,
          identifier: issueId.identifier
        },
        ...parentsInfo
      ]

      for (const child of issue.subdocs) {
        await this.createIssueWithSubissues(child as ImportIssue, issueId.id, project, parentsInfoEx)
      }
    }

    return issueId.id
  }

  async createProject (project: ImportProject): Promise<Ref<Project>> {
    const projectId = generateId<Project>()
    const projectType = this.projectTypeByName.get(project.projectType.name)
    const defaultIssueStatus =
      project.defaultIssueStatus !== undefined
        ? this.issueStatusByName.get(project.defaultIssueStatus.name)
        : tracker.status.Backlog
    const identifier = await this.uniqueProjectIdentifier(project.identifier)
    const projectData = {
      name: project.name,
      description: project.description ?? '',
      private: project.private,
      members: [], // todo
      owners: [], // todo
      archived: false,
      autoJoin: project.autoJoin,
      identifier,
      sequence: 0,
      defaultIssueStatus: defaultIssueStatus ?? tracker.status.Backlog, // todo: test with no status
      defaultTimeReportDay: TimeReportDayType.PreviousWorkDay,
      type: projectType ?? generateId() // tracker.ids.ClassicProjectType // todo: fixme! handle project type is not set or created before the import
    }
    await this.client.createDoc(tracker.class.Project, core.space.Space, projectData, projectId)

    const mixinId = `${this.projectTypeByName.get(project.projectType.name)}:type:mixin` as Ref<Mixin<Project>>
    await this.client.createMixin(projectId, tracker.class.Project, core.space.Space, mixinId, {})

    return projectId
  }

  async createIssue (
    issue: ImportIssue,
    project: Project,
    parentId: Ref<Issue>,
    parentsInfo: IssueParentInfo[]
  ): Promise<{ id: Ref<Issue>, identifier: string }> {
    const issueId = generateId<Issue>()
    const lastOne = await this.client.findOne<Issue>(
      tracker.class.Issue,
      { space: project._id },
      { sort: { rank: SortingOrder.Descending } }
    )
    const incResult = await this.client.updateDoc(
      tracker.class.Project,
      core.space.Space,
      project._id,
      {
        $inc: { sequence: 1 }
      },
      true
    )

    const number = (incResult as any).object.sequence
    const identifier = `${project?.identifier}-${number}`

    const taskKind = project?.type !== undefined ? { parent: project.type } : {}
    const kind = (await this.client.findOne(task.class.TaskType, taskKind)) as TaskType

    const collabId = await this.importIssueDescription(issueId, await issue.descrProvider())

    const estimation = issue.estimation ?? 0
    const remainingTime = issue.remainingTime ?? 0
    const reportedTime = estimation - remainingTime

    const status = await this.findIssueStatusByName(issue.status.name)
    await this.client.addCollection(
      tracker.class.Issue,
      project._id,
      parentId,
      tracker.class.Issue,
      'subIssues',
      {
        title: issue.title,
        description: collabId,
        assignee: issue.assignee ?? null,
        component: null,
        number,
        status,
        priority: IssuePriority.NoPriority, // todo
        rank: makeRank(lastOne?.rank, undefined),
        comments: issue.comments?.length ?? 0,
        subIssues: 0, // todo
        dueDate: null,
        parents: parentsInfo,
        remainingTime,
        estimation,
        reportedTime,
        reports: 0,
        childInfo: [],
        identifier,
        kind: kind._id
      },
      issueId
    )

    if (issue.comments !== undefined) {
      const comments = issue.comments.sort((a, b) => {
        const now = Date.now()
        return (a.date ?? now) - (b.date ?? now)
      })
      for (const comment of comments) {
        await this.importComment(issueId, comment, project._id)
      }
    }
    return { id: issueId, identifier }
  }

  async importIssueDescription (
    id: Ref<Issue>,
    data: string
  ): Promise<CollaborativeDoc> {
    const json = parseMessageMarkdown(data ?? '', 'image://')
    const processedJson = this.preprocessor.process(json)
    const collabId = makeCollaborativeDoc(id, 'description')

    const yDoc = jsonToYDocNoSchema(processedJson, 'description')
    const { documentId } = collaborativeDocParse(collabId)
    const buffer = yDocToBuffer(yDoc)

    const form = new FormData()
    const file = new File([new Blob([buffer])], collabId)
    form.append('file', file, documentId)
    form.append('type', 'application/ydoc')
    form.append('size', buffer.length.toString())
    form.append('name', collabId)
    form.append('id', id)
    form.append('data', new Blob([buffer])) // ?

    await this.fileUploader(id, form)

    return collabId
  }

  async importComment (issueId: Ref<Issue>, comment: ImportComment, projectId: Ref<Project>): Promise<void> {
    const json = parseMessageMarkdown(comment.text ?? '', 'image://')
    const processedJson = this.preprocessor.process(json)
    const markup = jsonToMarkup(processedJson)

    const value: AttachedData<ChatMessage> = {
      message: markup,
      attachments: comment.attachments?.length
    }

    const commentId = generateId<ChatMessage>()
    await this.client.addCollection(
      chunter.class.ChatMessage,
      projectId,
      issueId,
      tracker.class.Issue,
      'comments',
      value,
      commentId,
      comment.date,
      comment.author // todo: as Ref<Account>
    )

    if (comment.attachments !== undefined) {
      for (const attach of comment.attachments) {
        const blob = await attach.blobProvider()
        if (blob === null) continue

        const file = new File([blob], attach.title)

        const form = new FormData()
        form.append('file', file)
        form.append('type', file.type)
        form.append('size', file.size.toString())
        form.append('name', attach.title)
        const attachmentId = generateId<Attachment>()
        form.append('id', attachmentId)
        form.append('data', blob) // ?

        const res = await this.fileUploader(attachmentId, form)
        if (res.status === 200) {
          const uuid = await res.text()
          // as [
          //   {
          //     key: 'file',
          //     id: uuid
          //   }
          // ]
          await this.client.addCollection(
            attachment.class.Attachment,
            projectId,
            commentId,
            chunter.class.ChatMessage,
            'attachments',
            {
              file: JSON.parse(uuid)[0].id,
              lastModified: Date.now(),
              name: file.name,
              size: file.size,
              type: file.type
            },
            attachmentId
          )
        }
      }
    }
  }

  async findIssueStatusByName (name: string): Promise<Ref<IssueStatus>> {
    const query: DocumentQuery<Status> = {
      name,
      ofAttribute: tracker.attribute.IssueStatus,
      category: task.statusCategory.Active
    }

    const status = await this.client.findOne(tracker.class.IssueStatus, query)
    if (status === undefined) {
      throw new Error('Issue status not found: ' + name)
    }

    return status._id
  }

  async uniqueProjectIdentifier (baseIdentifier: string): Promise<string> {
    const projects = await this.client.findAll(tracker.class.Project, {})
    const projectsIdentifiers = new Set(projects.map(({ identifier }) => identifier))

    let identifier = baseIdentifier
    let i = 1
    while (projectsIdentifiers.has(identifier)) {
      identifier = `${baseIdentifier}${i}`
      i++
    }
    return identifier
  }
}
