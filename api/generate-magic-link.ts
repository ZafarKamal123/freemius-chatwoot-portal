import {
  assertAccessAllowed,
  createFreemiusPortalLink,
  HttpError,
} from '../server/freemiusPortalCore.ts'
import {
  type ApiRequest,
  type ApiResponse,
  handleApiError,
  sendJson,
  sendNoContent,
} from '../server/apiResponse.ts'

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  try {
    if (request.method === 'OPTIONS') {
      sendNoContent(response, 'POST, OPTIONS')
      return
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'Use POST to open the customer portal.' })
      return
    }

    assertAccessAllowed(request.headers ?? {}, process.env)

    const body = readBody(request.body)
    const link = await createFreemiusPortalLink(body, process.env)

    sendJson(response, 200, { link })
  } catch (error) {
    handleApiError(error, response)
  }
}

function readBody(body: unknown) {
  if (typeof body !== 'string') {
    return body ?? {}
  }

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}
