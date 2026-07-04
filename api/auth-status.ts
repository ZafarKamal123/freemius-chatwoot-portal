import { assertAccessAllowed } from '../server/freemiusPortalCore.ts'
import {
  type ApiRequest,
  type ApiResponse,
  handleApiError,
  sendJson,
  sendNoContent,
} from './_response.ts'

export default function handler(request: ApiRequest, response: ApiResponse) {
  try {
    if (request.method === 'OPTIONS') {
      sendNoContent(response, 'GET, OPTIONS')
      return
    }

    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'Use GET to check dashboard authorization.' })
      return
    }

    assertAccessAllowed(request.headers, process.env)
    sendJson(response, 200, { authorized: true })
  } catch (error) {
    handleApiError(error, response)
  }
}
