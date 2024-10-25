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
  WorkspaceImporter
} from './importer/importer'
import contact, { type Person, type PersonAccount } from '@hcengineering/contact'

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

// todo: make it class
export async function importClickUp (
  client: TxOperations,
  fileUploader: FileUploader,
  dir: string,
  teamspaceName: string
): Promise<void> {
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
      const personsData = processPersonsFile(fullPath)
      persons.push(...personsData)
    } else if (extension === '.md') {
      console.log('Found Wiki Document: ', fullPath)
      teamspace.docs.push(processClickupWiki(fullPath))
    } else if (extension === '.csv') {
      console.log('Found CSV Tasks: ', fullPath)
      const projectsData = await processClickupTasks(client, fullPath)
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
  await new WorkspaceImporter(client, fileUploader, importData).performImport()
}

function processClickupWiki (fullPath: string): ImportDocument {
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

async function processTasksCsv (file: string, process: (json: ClickupTask) => Promise<void> | void): Promise<void> {
  const jsonArray = await csv().fromFile(file)
  for (const json of jsonArray) {
    const clickupTask = json as ClickupTask
    await process(clickupTask)
  }
}

interface TasksProcessResult {
  projects: ImportProject[]
  projectType: ImportProjectType
}

async function processClickupTasks (client: TxOperations, file: string): Promise<TasksProcessResult> {
  const persons = new Set<string>()
  const emails = new Set<string>()
  await processTasksCsv(file, async (clickupTask) => {
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

  const personsByName = await findPersonsByNames(client, persons)
  console.log('persons: ', persons)
  console.log('personsByName: ', personsByName)
  // const notFound = Array.from(persons).filter(name => !personsByName.has(name))
  // if (notFound.length > 0) {
  //   throw new Error('Persons not found: ' + JSON.stringify(notFound))
  // }

  const accountsByEmail = await findAccountsByEmails(client, Array.from(emails))
  console.log('emails: ', emails)
  console.log('accountsByEmail: ', accountsByEmail)
  // const accNotFound = Array.from(emails).filter(email => !accountsByEmail.has(email))
  // if (accNotFound.length > 0) {
  //   throw new Error('Accounts not found: ' + JSON.stringify(accNotFound))
  // }

  const statuses = new Set<string>()
  const projects = new Set<string>()
  const importIssuesByClickupId = new Map<string, ImportIssueEx>()
  await processTasksCsv(file, async (clickupTask) => {
    const importIssue = (await convertToImportIssue(clickupTask, personsByName, accountsByEmail)) as ImportIssueEx
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

  const importProjectType = createClickupProjectType(Array.from(statuses))

  const importProjectsByName = new Map<string, ImportProject>()
  for (const projectName of projects) {
    const identifier = getProjectIdentifier(projectName)
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

async function convertToImportIssue (
  clickup: ClickupTask,
  personsByName: Map<string, Ref<Person>>,
  accountsByEmail: Map<string, Ref<PersonAccount>>
): Promise<ImportIssue> {
  const status = {
    name: clickup.Status
  }

  const content = fixMultilineString(clickup['Task Content'])
  const checklists = convertChecklistsToMarkdown(clickup.Checklists)

  const estimation = clickup['Time Estimated']
  const remainingTime = estimation - clickup['Time Spent']

  const comments = convertToImportComments(clickup.Comments, accountsByEmail)
  const attachments = await convertAttachmentsToComment(clickup.Attachments)

  const description = `${content}\n\n---\n${checklists}` // todo: test all the combinations

  let assignee
  if (clickup.Assignees !== undefined) {
    const assignees = clickup.Assignees.substring(1, clickup.Assignees.length - 1).split(',')
    if (assignees.length > 0) {
      assignee = personsByName.get(assignees[0])
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

function convertToImportComments (clickup: string, accountsByEmail: Map<string, Ref<PersonAccount>>): ImportComment[] {
  return JSON.parse(clickup).map((comment: ClickupComment) => {
    return {
      text: comment.text,
      date: new Date(comment.date).getTime(),
      author: accountsByEmail.get(comment.by)
    }
  })
}

// todo: add attachments to description
async function convertAttachmentsToComment (clickup: string): Promise<ImportComment[]> {
  const res: ImportComment[] = []
  const attachments: ClickupAttachment[] = JSON.parse(clickup)
  for (const attachment of attachments) {
    res.push({
      // text: `</br> Attachment: <a href='${attachment.url}'>${attachment.title}</a>`,
      text: `(${attachment.url})[${attachment.title}]`,
      attachments: [{
        title: attachment.title,
        blobProvider: async () => { return await download(attachment.url) } // todo: handle error (broken link, or no vpn)
      }]
    })
  }
  return res
}

function convertChecklistsToMarkdown (clickup: string): string {
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

async function findPersonsByNames (client: TxOperations, names: Set<string>): Promise<Map<string, Ref<Person>>> {
  return (await client.findAll(contact.class.Person, {}))
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

async function findAccountsByEmails (client: TxOperations, emails: string[]): Promise<Map<string, Ref<PersonAccount>>> {
  const accounts = await client.findAll(contact.class.PersonAccount, { email: { $in: emails } })
  return accounts.reduce((accountsByEmail, account) => {
    accountsByEmail.set(account.email, account._id)
    return accountsByEmail
  }, new Map())
}

function fixMultilineString (content: string): string {
  return content.split('\\n').join('\n')
}

function getProjectIdentifier (projectName: string): string {
  return projectName.toUpperCase().replaceAll('-', '_').replaceAll(' ', '_').substring(0, 4)
}

function createClickupProjectType (taskStatuses: string[]): ImportProjectType {
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

function processPersonsFile (fullPath: string): ImportPerson[] {
  console.error('Function not implemented.')
  return []
}
