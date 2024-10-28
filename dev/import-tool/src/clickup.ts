import { type Ref, type Timestamp, type TxOperations } from '@hcengineering/core'
import { download, type FileUploader } from './fileUploader'
import { readdir, readFile } from 'fs/promises'
import { join, parse } from 'path'
import csv from 'csvtojson'
import {
  type ImportComment,
  type ImportDocument,
  type ImportIssue,
  type ImportPerson,
  type ImportProject,
  type ImportProjectType,
  type ImportTeamspace,
  type MarkdownPreprocessor,
  WorkspaceImporter
} from './importer/importer'
import contact, { type Person, type PersonAccount } from '@hcengineering/contact'
import { MarkupNodeType, traverseNode, type MarkupNode } from '@hcengineering/text'

interface ClickupTask {
  'Task ID': string
  'Task Name': string
  'Task Content': string
  Status: string
  'Parent ID': string
  Attachments: string
  Assignees: string
  Priority?: number
  'Space Name': string
  Checklists: string // todo: obj
  Comments: string // todo: obj[]
  'Time Estimated': number
  'Time Spent': number
}

interface ClickupComment {
  by: string
  date: Timestamp
  text: string
}

interface ClickupAttachment {
  title: string
  url: string
}

interface ImportIssueEx extends ImportIssue {
  clickupParentId?: string
  clickupProjectName?: string
}

class ClickupMarkdownPreprocessor implements MarkdownPreprocessor {
  private readonly MENTION_REGEX = /@([A-Za-z]+ [A-Za-z]+)/g
  constructor (private readonly personsByName: Map<string, Ref<Person>>) {}

  process (json: MarkupNode): MarkupNode {
    traverseNode(json, (node) => {
      if (node.type === MarkupNodeType.paragraph && node.content !== undefined) {
        const newContent: MarkupNode[] = []
        for (const childNode of node.content) {
          if (childNode.type === MarkupNodeType.text && childNode.text !== undefined) {
            let match
            let lastIndex = 0
            let hasMentions = false

            while ((match = this.MENTION_REGEX.exec(childNode.text)) !== null) {
              hasMentions = true
              if (match.index > lastIndex) {
                newContent.push({
                  type: MarkupNodeType.text,
                  text: childNode.text.slice(lastIndex, match.index),
                  marks: childNode.marks,
                  attrs: childNode.attrs
                })
              }

              const name = match[1]
              const personRef = this.personsByName.get(name)
              if (personRef !== undefined) {
                newContent.push({
                  type: MarkupNodeType.reference,
                  attrs: {
                    id: personRef,
                    label: name,
                    objectclass: contact.class.Person
                  }
                })
              } else {
                newContent.push({
                  type: MarkupNodeType.text,
                  text: match[0],
                  marks: childNode.marks,
                  attrs: childNode.attrs
                })
              }

              lastIndex = this.MENTION_REGEX.lastIndex
            }

            if (hasMentions) {
              if (lastIndex < childNode.text.length) {
                newContent.push({
                  type: MarkupNodeType.text,
                  text: childNode.text.slice(lastIndex),
                  marks: childNode.marks,
                  attrs: childNode.attrs
                })
              }
            } else {
              newContent.push(childNode)
            }
          } else {
            newContent.push(childNode)
          }
        }

        node.content = newContent
        return false
      }
      return true
    })

    return json
  }
}

interface TasksProcessResult {
  projects: ImportProject[]
  projectType: ImportProjectType
}

class ClickupImporter {
  private personsByName = new Map<string, Ref<Person>>()
  private accountsByEmail = new Map<string, Ref<PersonAccount>>()

  constructor (
    private readonly client: TxOperations,
    private readonly fileUploader: FileUploader
  ) {}

  async importClickUp (dir: string, teamspaceName: string): Promise<void> {
    const files = await readdir(dir, { recursive: true })
    console.log(files)

    const persons: ImportPerson[] = []
    const projectTypes: ImportProjectType[] = []
    const projects: ImportProject[] = []
    const teamspace: ImportTeamspace = {
      class: 'document.class.TeamSpace',
      name: teamspaceName,
      docs: []
    }

    for (const file of files) {
      const parsedFileName = parse(file)
      const extension = parsedFileName.ext.toLowerCase()
      const fullPath = join(dir, file)
      if (file === 'persons.yaml') {
        console.log('Found Persons List: ', fullPath)
        const personsData = this.processPersonsFile(fullPath)
        persons.push(...personsData)
      } else if (extension === '.md') {
        console.log('Found Wiki Document: ', fullPath)
        teamspace.docs.push(this.processClickupWiki(fullPath))
      } else if (extension === '.csv') {
        console.log('Found CSV Tasks: ', fullPath)
        const projectsData = await this.processClickupTasks(fullPath)
        projectTypes.push(projectsData.projectType)
        projects.push(...projectsData.projects)
      }
    }

    const spaces = teamspace.docs.length > 0 ? [...projects, teamspace] : projects

    const importData = {
      persons,
      projectTypes,
      spaces
    }

    console.log('========================================')
    console.log('IMPORT DATA STRUCTURE: ', JSON.stringify(importData, null, 4))
    console.log('========================================')
    const postprocessor = new ClickupMarkdownPreprocessor(this.personsByName)
    await new WorkspaceImporter(this.client, this.fileUploader, importData, postprocessor).performImport()
  }

  private processClickupWiki (fullPath: string): ImportDocument {
    return {
      class: 'document.class.Document',
      title: parse(fullPath).name,
      descrProvider: async () => {
        const description = await readFile(fullPath)
        console.log(description.toString())
        console.log(description.toString())
        return description.toString()
      },
      subdocs: []
    }
  }

  private async processTasksCsv (file: string, process: (json: ClickupTask) => Promise<void> | void): Promise<void> {
    const jsonArray = await csv().fromFile(file)
    for (const json of jsonArray) {
      const clickupTask = json as ClickupTask
      await process(clickupTask)
    }
  }

  private async processClickupTasks (file: string): Promise<TasksProcessResult> {
    const persons = new Set<string>()
    const emails = new Set<string>()
    await this.processTasksCsv(file, async (clickupTask) => {
      clickupTask.Assignees.substring(1, clickupTask.Assignees.length - 1).split(',')
        .filter((name) => name.length > 0)
        .forEach((name) => persons.add(name))

      JSON.parse(clickupTask.Comments)
        .forEach((comment: ClickupComment) => {
          if (comment.by !== undefined) {
            console.log(clickupTask)
            console.log(comment)

            emails.add(comment.by)
          }
        })
    })

    await this.fillPersonsByNames(persons)
    console.log('persons: ', persons)
    console.log('personsByName: ', this.personsByName)
    // const notFound = Array.from(persons).filter(name => !this.personsByName.has(name))
    // if (notFound.length > 0) {
    //   throw new Error('Persons not found: ' + JSON.stringify(notFound))
    // }

    await this.fillAccountsByEmails(Array.from(emails))
    console.log('emails: ', emails)
    console.log('accountsByEmail: ', this.accountsByEmail)
    // const accNotFound = Array.from(emails).filter(email => !this.accountsByEmail.has(email))
    // if (accNotFound.length > 0) {
    //   throw new Error('Accounts not found: ' + JSON.stringify(accNotFound))
    // }

    const statuses = new Set<string>()
    const projects = new Set<string>()
    const importIssuesByClickupId = new Map<string, ImportIssueEx>()
    await this.processTasksCsv(file, async (clickupTask) => {
      const importIssue = (await this.convertToImportIssue(clickupTask)) as ImportIssueEx
      importIssue.clickupParentId = clickupTask['Parent ID']
      importIssue.clickupProjectName = clickupTask['Space Name']
      importIssuesByClickupId.set(clickupTask['Task ID'], importIssue)

      statuses.add(clickupTask.Status)
      projects.add(clickupTask['Space Name'])

      clickupTask.Assignees.substring(1, clickupTask.Assignees.length - 1).split(',')
        .filter((name) => name.length > 0)
        .forEach((name) => persons.add(name))

      JSON.parse(clickupTask.Comments)
        .forEach((comment: ClickupComment) => {
          if (comment.by === undefined) {
            console.log(clickupTask)
            console.log(comment)

            emails.add(comment.by)
          }
        })
    })

    console.log(projects)
    console.log(statuses)
    // console.log(importIssuesByClickupId)

    const importProjectType = this.createClickupProjectType(Array.from(statuses))

    const importProjectsByName = new Map<string, ImportProject>()
    for (const projectName of projects) {
      const identifier = this.getProjectIdentifier(projectName)
      importProjectsByName.set(projectName, {
        class: 'tracker.class.Project',
        name: projectName,
        identifier,
        private: false,
        autoJoin: false,
        projectType: importProjectType,
        docs: []
      })
    }

    for (const [clickupId, issue] of importIssuesByClickupId) {
      if (issue.clickupParentId !== undefined && issue.clickupParentId !== 'null') {
        const parent = importIssuesByClickupId.get(issue.clickupParentId)
        if (parent === undefined) {
          throw new Error(`Parent not found: ${issue.clickupParentId} (for task: ${clickupId})`)
        }
        parent.subdocs.push(issue)
      } else if (issue.clickupProjectName !== undefined && issue.clickupProjectName !== 'null') {
        // todo: blank string
        const project = importProjectsByName.get(issue.clickupProjectName)
        if (project === undefined) {
          throw new Error(`Project not found: ${issue.clickupProjectName} (for task: ${clickupId})`)
        }
        project.docs.push(issue)
      } else {
        throw new Error(`Task cannot be imported: ${clickupId} (No parent)`)
      }
    }

    return {
      projects: Array.from(importProjectsByName.values()),
      projectType: importProjectType
    }
  }

  private async convertToImportIssue (
    clickup: ClickupTask
  ): Promise<ImportIssue> {
    const status = {
      name: clickup.Status
    }

    const content = this.fixMultilineString(clickup['Task Content'])
    const checklists = this.convertChecklistsToMarkdown(clickup.Checklists)

    const estimation = clickup['Time Estimated']
    const remainingTime = estimation - clickup['Time Spent']

    const comments = this.convertToImportComments(clickup.Comments)
    const attachments = await this.convertAttachmentsToComment(clickup.Attachments)

    const description = `${content}\n\n---\n${checklists}` // todo: test all the combinations

    let assignee
    if (clickup.Assignees !== undefined) {
      const assignees = clickup.Assignees.substring(1, clickup.Assignees.length - 1).split(',')
      if (assignees.length > 0) {
        assignee = this.personsByName.get(assignees[0])
      }
    }

    return {
      class: 'tracker.class.Issue',
      title: clickup['Task Name'],
      descrProvider: () => {
        return Promise.resolve(description)
      },
      status,
      estimation,
      remainingTime,
      comments: comments.concat(attachments),
      subdocs: [],
      assignee
    }
  }

  private convertToImportComments (clickup: string): ImportComment[] {
    return JSON.parse(clickup).map((comment: ClickupComment) => {
      const author = this.accountsByEmail.get(comment.by)
      return {
        text: author !== undefined ? comment.text : `${comment.text}\n\n*(comment by ${comment.by})*`,
        date: new Date(comment.date).getTime(),
        author
      }
    })
  }

  private async convertAttachmentsToComment (clickup: string): Promise<ImportComment[]> {
    const res: ImportComment[] = []
    const attachments: ClickupAttachment[] = JSON.parse(clickup)
    for (const attachment of attachments) {
      res.push({
        text: `Original attachment link: ${attachment.title}](${attachment.url})`,
        attachments: [{
          title: attachment.title,
          blobProvider: async () => { return await download(attachment.url) } // todo: handle error (broken link, or no vpn)
        }]
      })
    }
    return res
  }

  private convertChecklistsToMarkdown (clickup: string): string {
    const checklists = JSON.parse(clickup)
    let huly: string = '\n'
    for (const [key, values] of Object.entries(checklists)) {
      huly += `**${key}**\n`
      for (const value of values as string[]) {
        huly += `* [ ] ${value} \n` // todo: test and fix for checked items
      }
      huly += '\n'
    }
    return huly
  }

  private async fillPersonsByNames (names: Set<string>): Promise<void> {
    this.personsByName = (await this.client.findAll(contact.class.Person, {}))
      .map((person) => {
        return {
          _id: person._id,
          name: person.name.split(',').reverse().join(' ')
        }
      })
      .filter(person => names.has(person.name))
      .reduce((refByName, person) => {
        refByName.set(person.name, person._id)
        return refByName
      }, new Map())
  }

  private async fillAccountsByEmails (emails: string[]): Promise<void> {
    const accounts = await this.client.findAll(contact.class.PersonAccount, { email: { $in: emails } })
    this.accountsByEmail = accounts.reduce((accountsByEmail, account) => {
      accountsByEmail.set(account.email, account._id)
      return accountsByEmail
    }, new Map())
  }

  private fixMultilineString (content: string): string {
    return content.split('\\n').join('\n')
  }

  private getProjectIdentifier (projectName: string): string {
    return projectName.toUpperCase().replaceAll('-', '_').replaceAll(' ', '_').substring(0, 4)
  }

  private createClickupProjectType (taskStatuses: string[]): ImportProjectType {
    const statuses = taskStatuses.map((name) => {
      return {
        name
      }
    })
    return {
      name: 'ClickUp project',
      description: 'For issues imported from ClickUp',
      taskTypes: [
        {
          name: 'ClickUp issue',
          statuses
        }
      ]
    }
  }

  private processPersonsFile (fullPath: string): ImportPerson[] {
    console.error('Function not implemented.')
    return []
  }
}

// Export the class instead of the function
export { ClickupImporter }
