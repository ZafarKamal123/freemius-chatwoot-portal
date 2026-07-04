import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  assertAccessAllowed,
  createFreemiusPortalLink,
  type EnvSource,
  HttpError,
  type JsonRecord,
} from './freemiusPortalCore.ts'

type NextHandler = () => void

const maxRequestBytes = 16 * 1024

export function freemiusPortalMiddleware(env: EnvSource = process.env) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: NextHandler,
  ) => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost')

    if (
      requestUrl.pathname !== '/api/generate-magic-link' &&
      requestUrl.pathname !== '/api/auth-status'
    ) {
      next()
      return
    }

    try {
      if (requestUrl.pathname === '/api/auth-status') {
        handleAuthStatus(req, res, env)
        return
      }

      await handleGenerateMagicLink(req, res, env)
    } catch (error) {
      handleRouteError(error, res)
    }
  }
}

function handleAuthStatus(
  req: IncomingMessage,
  res: ServerResponse,
  env: EnvSource,
) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      Allow: 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    })
    res.end()
    return
  }

  if (req.method !== 'GET') {
    throw new HttpError(405, 'Use GET to check dashboard authorization.')
  }

  assertAccessAllowed(req.headers, env)
  sendJson(res, 200, { authorized: true })
}

async function handleGenerateMagicLink(
  req: IncomingMessage,
  res: ServerResponse,
  env: EnvSource,
) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store',
    })
    res.end()
    return
  }

  if (req.method !== 'POST') {
    throw new HttpError(405, 'Use POST to open the customer portal.')
  }

  assertAccessAllowed(req.headers, env)

  const body = await readJsonBody(req)
  const link = await createFreemiusPortalLink(body, env)

  sendJson(res, 200, { link })
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength

    if (size > maxRequestBytes) {
      throw new HttpError(413, 'Request body is too large.')
    }

    chunks.push(buffer)
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: JsonRecord) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(body))
}

function handleRouteError(error: unknown, res: ServerResponse) {
  if (res.headersSent) {
    res.end()
    return
  }

  const statusCode = readErrorStatusCode(error)
  const message = readErrorMessage(error)

  if (statusCode) {
    sendJson(res, statusCode, { error: message })
    return
  }

  console.error('Unexpected portal route error', error)
  sendJson(res, 500, { error: 'Unexpected server error.' })
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
