import { type FormEvent, useEffect, useState } from 'react'
import {
  defaultFreemiusProductId,
  freemiusProducts,
  isFreemiusProductId,
} from '../shared/freemiusProducts'
import './App.css'

type RequestStatus = 'idle' | 'loading' | 'success' | 'error'
type AuthStatus = 'checking' | 'authorized' | 'unauthorized'

type PortalResponse = {
  link?: string
  error?: string
}

type AuthResponse = {
  authorized?: boolean
  error?: string
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const emailParamNames = ['email', 'customer_email', 'contact_email']
const productParamNames = ['product_id', 'productId', 'product']
const accessTokenParamNames = ['access_token', 'token']
const accessTokenStorageKey = 'chatwoot-freemius-access-token'

function isValidEmail(value: string) {
  return value.length <= 254 && emailPattern.test(value)
}

function readSearchParam(names: string[]) {
  const params = new URLSearchParams(window.location.search)

  for (const name of names) {
    const value = params.get(name)?.trim()

    if (value) {
      return value
    }
  }

  return ''
}

function removeAccessTokenFromUrl() {
  const url = new URL(window.location.href)
  let changed = false

  for (const name of accessTokenParamNames) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name)
      changed = true
    }
  }

  if (changed) {
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    )
  }
}

function readStoredAccessToken() {
  try {
    return window.sessionStorage.getItem(accessTokenStorageKey)?.trim() ?? ''
  } catch {
    return ''
  }
}

function storeAccessToken(accessToken: string) {
  try {
    window.sessionStorage.setItem(accessTokenStorageKey, accessToken)
  } catch {
    // Authorization still works for this load if sessionStorage is unavailable.
  }
}

function clearStoredAccessToken() {
  try {
    window.sessionStorage.removeItem(accessTokenStorageKey)
  } catch {
    // Nothing to clear if browser storage is unavailable.
  }
}

function coerceEmail(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const email = value.trim()
  return isValidEmail(email) ? email : null
}

function findEmail(value: unknown, depth = 0): string | null {
  if (depth > 5 || value === null || value === undefined) {
    return null
  }

  const directEmail = coerceEmail(value)

  if (directEmail) {
    return directEmail
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const email = findEmail(item, depth + 1)

      if (email) {
        return email
      }
    }

    return null
  }

  if (typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>

  for (const [key, item] of Object.entries(record)) {
    if (key.toLowerCase().includes('email')) {
      const email = coerceEmail(item)

      if (email) {
        return email
      }
    }
  }

  for (const item of Object.values(record)) {
    const email = findEmail(item, depth + 1)

    if (email) {
      return email
    }
  }

  return null
}

function getResponseMessage(response: { error?: string } | null) {
  return response?.error ?? 'Could not create a customer portal link.'
}

function readInitialProductId() {
  const productId = readSearchParam(productParamNames)
  return isFreemiusProductId(productId) ? productId : defaultFreemiusProductId
}

function readInitialAccessToken() {
  const queryAccessToken = readSearchParam(accessTokenParamNames)

  if (queryAccessToken) {
    storeAccessToken(queryAccessToken)
    return queryAccessToken
  }

  return readStoredAccessToken()
}

function App() {
  const [accessToken] = useState(readInitialAccessToken)
  const [email, setEmail] = useState(() => readSearchParam(emailParamNames))
  const [productId, setProductId] = useState(readInitialProductId)
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking')
  const [authMessage, setAuthMessage] = useState('')
  const [status, setStatus] = useState<RequestStatus>('idle')
  const [message, setMessage] = useState('')
  const [portalUrl, setPortalUrl] = useState('')

  const normalizedEmail = email.trim()
  const isAuthorized = authStatus === 'authorized'
  const canSubmit =
    isAuthorized &&
    isValidEmail(normalizedEmail) &&
    isFreemiusProductId(productId) &&
    status !== 'loading'

  useEffect(() => {
    if (accessToken) {
      removeAccessTokenFromUrl()
    }
  }, [accessToken])

  useEffect(() => {
    let isMounted = true

    async function checkAuthorization() {
      const headers: Record<string, string> = {}

      if (accessToken) {
        headers['X-Portal-Access-Token'] = accessToken
      }

      try {
        const response = await fetch('/api/auth-status', { headers })
        const data = (await response.json().catch(() => null)) as AuthResponse | null

        if (!isMounted) {
          return
        }

        if (!response.ok) {
          setAuthStatus('unauthorized')
          setAuthMessage(data?.error ?? 'This dashboard app is not authorized.')
          clearStoredAccessToken()
          return
        }

        setAuthStatus('authorized')
        setAuthMessage('')
      } catch {
        if (!isMounted) {
          return
        }

        setAuthStatus('unauthorized')
        setAuthMessage('Could not verify dashboard access.')
      }
    }

    checkAuthorization()

    return () => {
      isMounted = false
    }
  }, [accessToken])

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const discoveredEmail = findEmail(event.data)

      if (!discoveredEmail) {
        return
      }

      setEmail((currentEmail) => currentEmail.trim() || discoveredEmail)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isAuthorized) {
      setStatus('error')
      setMessage('This dashboard app is not authorized.')
      return
    }

    if (!isValidEmail(normalizedEmail)) {
      setStatus('error')
      setMessage('Enter a valid customer email address.')
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (accessToken) {
      headers['X-Portal-Access-Token'] = accessToken
    }

    setStatus('loading')
    setMessage('Opening the customer portal...')
    setPortalUrl('')

    try {
      const response = await fetch('/api/generate-magic-link', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: normalizedEmail, productId }),
      })
      const data = (await response.json().catch(() => null)) as PortalResponse | null

      if (!response.ok) {
        if (response.status === 401) {
          setAuthStatus('unauthorized')
          setAuthMessage(data?.error ?? 'This dashboard app is not authorized.')
          clearStoredAccessToken()
          setPortalUrl('')
          return
        }

        throw new Error(getResponseMessage(data))
      }

      if (!data?.link) {
        throw new Error('Freemius did not return a customer portal link.')
      }

      const portalWindow = window.open(data.link, '_blank', 'noopener,noreferrer')

      setPortalUrl(data.link)
      setStatus('success')
      setMessage(
        portalWindow
          ? 'Customer portal opened in a new tab.'
          : 'New tab blocked. Use the portal link below.',
      )
    } catch (error) {
      setStatus('error')
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not create a customer portal link.',
      )
    }
  }

  return (
    <main className="app-shell">
      <section className="portal-panel" aria-labelledby="portal-title">
        <div className="panel-header">
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true">
              CW
            </span>
            <span>Chatwoot</span>
          </div>
          <h1 id="portal-title">Freemius customer portal</h1>
        </div>

        {authStatus === 'checking' ? (
          <div className="lock-panel" role="status">
            Verifying dashboard access...
          </div>
        ) : null}

        {authStatus === 'unauthorized' ? (
          <div className="lock-panel error" role="alert">
            <strong>Dashboard app locked</strong>
            <span>
              {authMessage ||
                'Open this dashboard app from Chatwoot with a valid access token.'}
            </span>
          </div>
        ) : null}

        {isAuthorized ? (
          <>
            <form className="portal-form" onSubmit={handleSubmit}>
              <label htmlFor="customer-email">Customer email</label>
              <input
                id="customer-email"
                type="email"
                value={email}
                placeholder="customer@example.com"
                autoComplete="email"
                autoFocus
                aria-describedby="portal-status"
                onChange={(event) => {
                  setEmail(event.target.value)
                  setPortalUrl('')

                  if (status !== 'loading') {
                    setStatus('idle')
                    setMessage('')
                  }
                }}
              />

              <label htmlFor="freemius-product">Product</label>
              <select
                id="freemius-product"
                value={productId}
                aria-describedby="portal-status"
                onChange={(event) => {
                  const selectedProductId = event.target.value

                  if (!isFreemiusProductId(selectedProductId)) {
                    return
                  }

                  setProductId(selectedProductId)
                  setPortalUrl('')

                  if (status !== 'loading') {
                    setStatus('idle')
                    setMessage('')
                  }
                }}
              >
                {freemiusProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>

              <button type="submit" disabled={!canSubmit}>
                {status === 'loading' ? 'Opening...' : 'Open customer portal'}
              </button>
            </form>

            <div
              id="portal-status"
              className={`status-line ${status}`}
              role={status === 'error' ? 'alert' : 'status'}
            >
              {message}
            </div>

            {portalUrl ? (
              <a
                className="portal-link"
                href={portalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open portal link
              </a>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  )
}

export default App
