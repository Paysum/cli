import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'

const clientId = 'pca_paysum_cli'
const callbackPath = '/oauth/callback'
const callbackHost = '127.0.0.1'
const timeoutMs = 5 * 60_000

export async function browserLoginAvailable(api) {
  try {
    const response = await fetch(new URL('/api/oauth-apps/cli', api), {
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
    })
    return response.ok && (await response.json())?.client_id === clientId
  } catch {
    return false
  }
}

export async function browserLogin({ api, dashboard, onAuthorize }) {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(32).toString('base64url')
  const authorize = new URL('/oauth/authorize', dashboard)
  let finish
  const callback = new Promise((resolve) => { finish = resolve })
  let used = false
  let redirect
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    const raw = request.url || ''
    if (request.method !== 'GET' || used || !raw.startsWith(`${callbackPath}?`)) {
      response.writeHead(404).end('Not found.')
      return
    }
    const params = new URLSearchParams(raw.slice(callbackPath.length + 1))
    const code = params.get('code')
    const denied = params.get('error') === 'access_denied'
    if (
      request.headers.host !== `${callbackHost}:${server.address()?.port}` ||
      params.get('state') !== state ||
      (!denied && !/^[A-Za-z0-9_-]{43}$/.test(code || ''))
    ) {
      response.writeHead(400).end('Invalid Paysum sign-in callback.')
      return
    }
    used = true
    response.end(
      denied ? 'Paysum sign-in was cancelled.' : 'Return to your terminal to finish Paysum sign-in.',
      () => finish(denied ? null : code),
    )
  })
  const timer = setTimeout(() => finish(undefined), timeoutMs)
  let code
  try {
    server.listen(0, callbackHost)
    await once(server, 'listening')
    redirect = `http://${callbackHost}:${server.address().port}${callbackPath}`
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirect,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    onAuthorize(authorize.toString())
    code = await callback
  } finally {
    clearTimeout(timer)
    server.close()
    server.closeAllConnections()
  }
  if (code === undefined) throw new Error('Paysum sign-in timed out. Run `paysum login` again.')
  if (code === null) throw new Error('Paysum sign-in was cancelled.')
  const response = await fetch(new URL('/api/oauth-apps/token', api), {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirect,
      code,
      code_verifier: verifier,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error_description || 'Paysum could not complete sign-in.')
  if (
    !/^sk_[a-f0-9]{64}$/.test(data?.access_token || '') ||
    typeof data?.scope !== 'string' ||
    !data?.store?.id || !data.store.name || !data.store.slug || !data.store.url
  )
    throw new Error('Paysum returned an invalid sign-in response.')
  return { key: data.access_token, store: data.store, permissions: data.scope.split(' ') }
}
