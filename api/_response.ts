import { HttpError, type JsonRecord } from '../server/freemiusPortalCore.ts'

export type ApiRequest = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export type ApiResponse = {
  status(statusCode: number): ApiResponse
  setHeader(name: string, value: string): void
  json(body: JsonRecord): void
  end(): void
}

export function sendJson(
  response: ApiResponse,
  statusCode: number,
  body: JsonRecord,
) {
  response.setHeader('Cache-Control', 'no-store')
  response.status(statusCode).json(body)
}

export function sendNoContent(response: ApiResponse, allow: string) {
  response.setHeader('Allow', allow)
  response.setHeader('Cache-Control', 'no-store')
  response.status(204).end()
}

export function handleApiError(error: unknown, response: ApiResponse) {
  if (error instanceof HttpError) {
    sendJson(response, error.statusCode, { error: error.message })
    return
  }

  console.error('Unexpected portal API error', error)
  sendJson(response, 500, { error: 'Unexpected server error.' })
}
