import {
  type Timestamp,
  type TxOperations
} from '@hcengineering/core'
import { type FileUploader } from './fileUploader'
import {
  type Issue,
} from '@hcengineering/tracker'
import { readdir, readFile } from 'fs/promises'
import { join, parse } from 'path'
import csv from 'csvtojson'
import { ImportComment, ImportDoc, ImportDocument, ImportIssue, ImportPerson, ImportProject, ImportProjectType, ImportSpace, ImportTeamspace, WorkspaceImporter } from './importer/importer'

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
      console.log ("Found Persons List: ", fullPath)
      const personsData = processPersonsFile(fullPath)
      persons.push(...personsData)
    } else  if (extension === '.md') {
      console.log ("Found Wiki Document: ", fullPath)
      teamspace.docs.push(processClickupWiki(fullPath))
    } else if (extension === '.csv') {
      console.log ("Found CSV Tasks: ", fullPath)
      const projectsData = await processClickupTasks(fullPath)
      projectTypes.push(projectsData.projectType)
      projects.push(...projectsData.projects)
    }
  }

  const spaces = teamspace.docs.length > 0
    ? [...projects, teamspace]
    : projects

  const importData = {
    persons,
    projectTypes,
    spaces
  }

  console.log('========================================' )
  console.log('IMPORT DATA STRUCTURE: ', JSON.stringify(importData, null, 4) )
  console.log('========================================' )
  await new WorkspaceImporter(client, fileUploader, importData).performImport()
}

function processClickupWiki(fullPath: string): ImportDocument {
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

async function processClickupTasks (
  file: string
): Promise<TasksProcessResult> {
  const importIssuesByClickupId = new Map<string, ImportIssueEx>()
  const statuses = new Set<string>()
  const projects = new Set<string>()

  await processTasksCsv(file, async (clickupTask) => {
    const importIssue = await convertToImportIssue(clickupTask) as ImportIssueEx
    importIssue.clickupParentId = clickupTask['Parent ID']
    importIssue.clickupProjectName = clickupTask['Space Name']
    importIssuesByClickupId.set(clickupTask['Task ID'], importIssue)
    
    statuses.add(clickupTask.Status)
    projects.add(clickupTask['Space Name'])
  })

  console.log(projects)
  console.log(statuses)
  console.log(importIssuesByClickupId)

  const importProjectType = createClickupProjectType(Array.from(statuses))

  const importProjectsByName = new Map<string, ImportProject>()
  for (const projectName of projects) {
    importProjectsByName.set(projectName, {
      class: 'tracker.class.Project',
      name: projectName,
      identifier: getIdentifier(projectName),
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
    } else if (issue.clickupProjectName !== undefined && issue.clickupProjectName !== 'null') { // todo: blank string
      const project = importProjectsByName.get(issue.clickupProjectName)
      if (project === undefined) {
        throw new Error(`Project not found: ${issue.clickupProjectName} (for task: ${clickupId})`)
      }
      project.docs.push(issue)
    } else {
      throw new Error(`Task cannot be imported: ${clickupId} (No parent)` )
    }
  }

  return {
    projects: Array.from(importProjectsByName.values()),
    projectType: importProjectType
  }
}

async function convertToImportIssue (clickup: ClickupTask): Promise<ImportIssue> {
  const status = {
    name: clickup.Status
  }

  const content = fixMultilineString(clickup['Task Content'])
  const checklists = convertChecklistsToMarkdown(clickup.Checklists)

  const estimation = clickup['Time Estimated']
  const remainingTime = estimation - clickup['Time Spent']

  const comments = convertToImportComments(clickup.Comments)
  // const attachments = await convertAttachmentsToComment(clickup.Attachments)

  const description = `${content}\n\n---\n${checklists}` // todo: test all the combinations
  return {
    class: 'tracker.class.Issue',
    title: '[' + clickup['Task ID'] + '] ' + clickup['Task Name'],
    descrProvider: () => { return Promise.resolve(description) },
    status,
    estimation,
    remainingTime,
    comments,
    subdocs: []
  }
}

function convertToImportComments (clickup: string): ImportComment[] {
  return JSON.parse(clickup).map((comment: ClickupComment) => {
    return {
      text: comment.text,
      date: new Date(comment.date).getTime()
    }
  })
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

function fixMultilineString (content: string) {
  return content.split('\\n').join('\n')
}

export interface ClickupIssue extends Issue {
  clickupId: string
}

function getIdentifier(projectName: string): string {
  return projectName.toUpperCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_')
    .substring(0, 5)
}

function createClickupProjectType(taskStatuses: string[]): ImportProjectType {
  const statuses = taskStatuses.map((name) => {
    return {
      name
    }
  })
 return {
  name: 'ClickUp project!!!',
  description: 'For issues imported from ClickUp!!!',
  taskTypes: [{
    name: 'ClickUp issue',
    statuses
  }]
 }
}

function processPersonsFile(fullPath: string): ImportPerson[] {
  console.log('Function not implemented.')
  return []
}
