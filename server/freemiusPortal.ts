import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type FreemiusProduct,
  getFreemiusProduct,
} from '../shared/freemiusProducts.ts'

type JsonRecord = Record<string, unknown>
type NextHandler = () => void
type EnvSource = Record<string, string | undefined>

const maxRequestBytes = 16 * 1024
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

class HttpError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export function freemiusPortalMiddleware(env: EnvSource = process.env) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: NextHandler,
  ) => {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost')

    if (requestUrl.pathname !== '/api/generate-magic-link') {
      next()
      return
    }

    try {
      await handleGenerateMagicLink(req, res, env)
    } catch (error) {
      handleRouteError(error, res)
    }
  }
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

  assertAccessAllowed(req, env)

  const body = await readJsonBody(req)
  const email = readEmail(body)
  const product = readProduct(body)
  const link = await requestFreemiusPortalLink(email, product, env)

  sendJson(res, 200, { link })
}

function assertAccessAllowed(req: IncomingMessage, env: EnvSource) {
  const accessToken = env.PORTAL_ACCESS_TOKEN?.trim()

  if (!accessToken) {
    return
  }

  const header = req.headers['x-portal-access-token']
  const requestToken = Array.isArray(header) ? header[0] : header

  if (!requestToken || !tokensMatch(requestToken, accessToken)) {
    throw new HttpError(401, 'This dashboard app is not authorized.')
  }
}

function tokensMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  )
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

function readEmail(body: unknown) {
  if (!isJsonRecord(body) || typeof body.email !== 'string') {
    throw new HttpError(400, 'Customer email is required.')
  }

  const email = body.email.trim()

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Enter a valid customer email address.')
  }

  return email
}

function readProduct(body: unknown) {
  if (!isJsonRecord(body)) {
    throw new HttpError(400, 'Product is required.')
  }

  const productId = readProductIdValue(body)

  if (!productId) {
    throw new HttpError(400, 'Product is required.')
  }

  const product = getFreemiusProduct(productId)

  if (!product) {
    throw new HttpError(400, 'Choose a supported Freemius product.')
  }

  return product
}

function readProductIdValue(body: JsonRecord) {
  if (typeof body.productId === 'string') {
    return body.productId.trim()
  }

  if (typeof body.product_id === 'string') {
    return body.product_id.trim()
  }

  return ''
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidEmail(value: string) {
  return value.length <= 254 && emailPattern.test(value)
}

async function requestFreemiusPortalLink(
  email: string,
  product: FreemiusProduct,
  env: EnvSource,
) {
  const bearerToken = getRequiredEnv(product.bearerTokenEnvName, env)
  const url = `https://api.freemius.com/v1/products/${encodeURIComponent(
    product.id,
  )}/portal/login.json`

  let response: Response

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    })
  } catch (error) {
    console.error('Freemius portal request failed', error)
    throw new HttpError(502, 'Freemius is not reachable right now.')
  }

  const payload = await readResponsePayload(response)

  if (!response.ok) {
    console.error('Freemius portal request rejected', {
      status: response.status,
      payload,
    })

    if (response.status === 404) {
      throw new HttpError(404, 'No Freemius customer was found for that email.')
    }

    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, 'Freemius credentials were rejected.')
    }

    throw new HttpError(502, 'Freemius could not create a portal link.')
  }

  if (!isJsonRecord(payload) || typeof payload.link !== 'string') {
    console.error('Freemius portal response did not include a link', payload)
    throw new HttpError(502, 'Freemius did not return a customer portal link.')
  }

  return addNextPath(payload.link, env)
}

function getRequiredEnv(name: string, env: EnvSource) {
  const value = env[name]?.trim()

  if (!value) {
    throw new HttpError(500, `${name} is not configured on the server.`)
  }

  return value
}

async function readResponsePayload(response: Response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function addNextPath(link: string, env: EnvSource) {
  const nextPath = env.FREEMIUS_PORTAL_NEXT_PATH?.trim()

  if (!nextPath) {
    return link
  }

  if (!nextPath.startsWith('/store/')) {
    console.warn('Ignoring FREEMIUS_PORTAL_NEXT_PATH because it is not a store path.')
    return link
  }

  const url = new URL(link)
  url.searchParams.set('next', nextPath)
  return url.toString()
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

  if (error instanceof HttpError) {
    sendJson(res, error.statusCode, { error: error.message })
    return
  }

  console.error('Unexpected portal route error', error)
  sendJson(res, 500, { error: 'Unexpected server error.' })
}
