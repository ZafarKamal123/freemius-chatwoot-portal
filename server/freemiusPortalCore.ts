import { timingSafeEqual } from 'node:crypto'
import { type FreemiusProduct, getFreemiusProduct } from '../shared/freemiusProducts.ts'

export type EnvSource = Record<string, string | undefined>
export type JsonRecord = Record<string, unknown>
export type RequestHeaders = Record<string, string | string[] | undefined>

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class HttpError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export function assertAccessAllowed(headers: RequestHeaders, env: EnvSource) {
  const accessToken = env.PORTAL_ACCESS_TOKEN?.trim()

  if (!accessToken) {
    return
  }

  const header = readHeader(headers, 'x-portal-access-token')
  const requestToken = Array.isArray(header) ? header[0] : header

  if (!requestToken || !tokensMatch(requestToken, accessToken)) {
    throw new HttpError(401, 'This dashboard app is not authorized.')
  }
}

export async function createFreemiusPortalLink(body: unknown, env: EnvSource) {
  const email = readEmail(body)
  const product = readProduct(body)

  return requestFreemiusPortalLink(email, product, env)
}

function readHeader(headers: RequestHeaders, name: string) {
  const directHeader = headers[name]

  if (directHeader) {
    return directHeader
  }

  const lowerName = name.toLowerCase()
  const matchedKey = Object.keys(headers).find((key) => key.toLowerCase() === lowerName)

  return matchedKey ? headers[matchedKey] : undefined
}

function tokensMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  )
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

export function isJsonRecord(value: unknown): value is JsonRecord {
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
