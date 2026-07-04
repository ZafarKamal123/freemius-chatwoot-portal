import { timingSafeEqual } from 'node:crypto'

type ApiRequest = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
}

type ApiResponse = {
  status(statusCode: number): ApiResponse
  setHeader(name: string, value: string): void
  json(body: Record<string, unknown>): void
  end(): void
}

type FreemiusProduct = {
  id: string
  name: string
  bearerTokenEnvName: string
}

const freemiusProducts: FreemiusProduct[] = [
  {
    name: 'Frame Maker',
    id: '289295',
    bearerTokenEnvName: 'FREEMIUS_FRAME_MAKER_BEARER_TOKEN',
  },
  {
    name: 'Image Blend',
    id: '452236',
    bearerTokenEnvName: 'FREEMIUS_IMAGE_BLEND_BEARER_TOKEN',
  },
  {
    name: 'Collage Maker',
    id: '22331',
    bearerTokenEnvName: 'FREEMIUS_COLLAGE_MAKER_BEARER_TOKEN',
  },
  {
    name: 'Type Warp',
    id: '27131',
    bearerTokenEnvName: 'FREEMIUS_TYPE_WARP_BEARER_TOKEN',
  },
]

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const freemiusTimeoutMs = 8_000

class ApiError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  try {
    response.setHeader('Cache-Control', 'no-store')

    if (request.method === 'OPTIONS') {
      response.setHeader('Allow', 'POST, OPTIONS')
      response.status(204).end()
      return
    }

    if (request.method !== 'POST') {
      throw new ApiError(405, 'Use POST to open the customer portal.')
    }

    assertAccessAllowed(request.headers ?? {})

    const body = readBody(request.body)
    const email = readEmail(body)
    const product = readProduct(body)
    const link = await requestFreemiusPortalLink(email, product)

    response.status(200).json({ link })
  } catch (error) {
    handleError(error, response)
  }
}

function assertAccessAllowed(headers: Record<string, string | string[] | undefined>) {
  const configuredToken = process.env.PORTAL_ACCESS_TOKEN?.trim()

  if (!configuredToken) {
    return
  }

  const requestToken = readHeader(headers, 'x-portal-access-token')

  if (!requestToken || !tokensMatch(requestToken, configuredToken)) {
    throw new ApiError(401, 'This dashboard app is not authorized.')
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

function readBody(body: unknown) {
  if (typeof body !== 'string') {
    return body ?? {}
  }

  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.')
  }
}

function readEmail(body: unknown) {
  if (!isRecord(body) || typeof body.email !== 'string') {
    throw new ApiError(400, 'Customer email is required.')
  }

  const email = body.email.trim()

  if (!emailPattern.test(email) || email.length > 254) {
    throw new ApiError(400, 'Enter a valid customer email address.')
  }

  return email
}

function readProduct(body: unknown) {
  if (!isRecord(body)) {
    throw new ApiError(400, 'Product is required.')
  }

  const productId =
    typeof body.productId === 'string'
      ? body.productId.trim()
      : typeof body.product_id === 'string'
        ? body.product_id.trim()
        : ''
  const product = freemiusProducts.find((item) => item.id === productId)

  if (!product) {
    throw new ApiError(400, 'Choose a supported Freemius product.')
  }

  return product
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function requestFreemiusPortalLink(
  email: string,
  product: FreemiusProduct,
) {
  const bearerToken = process.env[product.bearerTokenEnvName]?.trim()

  if (!bearerToken) {
    throw new ApiError(500, `${product.bearerTokenEnvName} is not configured.`)
  }

  const url = `https://api.freemius.com/v1/products/${encodeURIComponent(
    product.id,
  )}/portal/login.json`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), freemiusTimeoutMs)

  try {
    const freemiusResponse = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    })
    const payload = await readResponsePayload(freemiusResponse)

    if (!freemiusResponse.ok) {
      console.error('Freemius portal request rejected', {
        productId: product.id,
        status: freemiusResponse.status,
        payload,
      })

      if (freemiusResponse.status === 404) {
        throw new ApiError(404, 'No Freemius customer was found for that email.')
      }

      if (freemiusResponse.status === 401 || freemiusResponse.status === 403) {
        throw new ApiError(502, 'Freemius credentials were rejected.')
      }

      throw new ApiError(502, 'Freemius could not create a portal link.')
    }

    if (!isRecord(payload) || typeof payload.link !== 'string') {
      console.error('Freemius response did not include a link', {
        productId: product.id,
        payload,
      })
      throw new ApiError(502, 'Freemius did not return a customer portal link.')
    }

    return addNextPath(payload.link)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(504, 'Freemius request timed out.')
    }

    console.error('Freemius portal request failed', {
      productId: product.id,
      error,
    })
    throw new ApiError(502, 'Freemius is not reachable right now.')
  } finally {
    clearTimeout(timeout)
  }
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

function addNextPath(link: string) {
  const nextPath = process.env.FREEMIUS_PORTAL_NEXT_PATH?.trim()

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

function handleError(error: unknown, response: ApiResponse) {
  if (error instanceof ApiError) {
    response.status(error.statusCode).json({ error: error.message })
    return
  }

  console.error('Unexpected generate-magic-link API error', error)
  response.status(500).json({ error: 'Unexpected server error.' })
}
