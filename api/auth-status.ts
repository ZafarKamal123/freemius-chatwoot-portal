import { timingSafeEqual } from 'node:crypto'
import { type ApiRequest, type ApiResponse } from '../server/apiResponse.ts'

export default function handler(request: ApiRequest, response: ApiResponse) {
  try {
    response.setHeader('Cache-Control', 'no-store')

    if (request.method === 'OPTIONS') {
      response.setHeader('Allow', 'GET, OPTIONS')
      response.status(204).end()
      return
    }

    if (request.method !== 'GET') {
      response
        .status(405)
        .json({ error: 'Use GET to check dashboard authorization.' })
      return
    }

    const configuredToken = process.env.PORTAL_ACCESS_TOKEN?.trim()

    if (!configuredToken) {
      response.status(200).json({ authorized: true })
      return
    }

    const requestToken = readHeader(request.headers ?? {}, 'x-portal-access-token')

    if (!requestToken || !tokensMatch(requestToken, configuredToken)) {
      response.status(401).json({ error: 'This dashboard app is not authorized.' })
      return
    }

    response.status(200).json({ authorized: true })
  } catch (error) {
    console.error('Unexpected auth-status API error', error)
    response.status(500).json({ error: 'Unexpected server error.' })
  }
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const lowerName = name.toLowerCase()
  const matchedKey = Object.keys(headers).find((key) => key.toLowerCase() === lowerName)
  const value = matchedKey ? headers[matchedKey] : undefined

  if (Array.isArray(value)) {
    return value[0]?.trim() ?? ''
  }

  return value?.trim() ?? ''
}

function tokensMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  )
}
