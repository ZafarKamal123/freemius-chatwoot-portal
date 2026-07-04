import { type JsonRecord } from './freemiusPortalCore.ts'

export type ApiRequest = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
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
  const statusCode = readErrorStatusCode(error)
  const message = readErrorMessage(error)

  if (statusCode) {
    sendJson(response, statusCode, { error: message })
    return
  }

  console.error('Unexpected portal API error', error)
  sendJson(response, 500, { error: 'Unexpected server error.' })
}

function readErrorStatusCode(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return null
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode

  if (
    typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode < 600
  ) {
    return statusCode
  }

  return null
}

function readErrorMessage(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return 'Unexpected server error.'
  }

  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : 'Unexpected server error.'
}
