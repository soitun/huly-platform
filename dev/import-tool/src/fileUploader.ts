import { concatLink } from '@hcengineering/core'

export type FileUploader = (id: string, data: any) => Promise<any>

export function getFileUploader (frontUrl: string, token: string): FileUploader {
  return (id: string, data: any) => {
    return fetch(concatLink(frontUrl, '/files'), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token
      },
      body: data
    })
  }
}
