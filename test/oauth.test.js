import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { browserLogin, browserLoginAvailable } from '../src/oauth.js'

test('browser sign-in is only enabled by the expected API response', async (t) => {
  let status = 401
  const api = createServer((request, response) => {
    assert.equal(request.url, '/api/oauth-apps/cli')
    response.writeHead(status).end(JSON.stringify({ client_id: 'pca_paysum_cli' }))
  })
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  t.after(() => api.close())
  const origin = `http://127.0.0.1:${api.address().port}`
  assert.equal(await browserLoginAvailable(origin), false)
  status = 200
  assert.equal(await browserLoginAvailable(origin), true)
})

test('browser sign-in ignores a wrong state and exchanges only a code with its PKCE verifier', async (t) => {
  const code = 'z'.repeat(43)
  const key = `sk_${'a'.repeat(64)}`
  const store = { id: 'store-id', name: 'Demo', slug: 'demo', url: 'https://demo.mypaysum.io' }
  let received
  const api = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    received = { path: request.url, method: request.method, form: new URLSearchParams(body) }
    response.end(JSON.stringify({ access_token: key, scope: 'store:read themes:write', store }))
  })
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  t.after(() => api.close())
  let opened
  const authorize = new Promise((resolve) => { opened = resolve })
  const login = browserLogin({
    api: `http://127.0.0.1:${api.address().port}`,
    dashboard: 'https://dashboard.paysum.io',
    onAuthorize: opened,
  })
  const url = new URL(await authorize)
  assert.equal(url.pathname, '/oauth/authorize')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.has('code_verifier'), false)
  const callback = new URL(url.searchParams.get('redirect_uri'))
  callback.search = new URLSearchParams({ state: 'wrong', code })
  assert.equal((await fetch(callback)).status, 400)
  assert.equal(received, undefined)
  callback.searchParams.set('state', url.searchParams.get('state'))
  assert.equal((await fetch(callback)).status, 200)
  assert.deepEqual(await login, { key, store, permissions: ['store:read', 'themes:write'] })
  assert.equal(received.path, '/api/oauth-apps/token')
  assert.equal(received.method, 'POST')
  assert.equal(received.form.get('code'), code)
  assert.equal(received.form.get('client_id'), 'pca_paysum_cli')
  assert.equal(received.form.has('client_secret'), false)
  const challenge = createHash('sha256').update(received.form.get('code_verifier')).digest('base64url')
  assert.equal(challenge, url.searchParams.get('code_challenge'))
})

test('denied browser consent ends sign-in without a token request', async () => {
  let opened
  const authorize = new Promise((resolve) => { opened = resolve })
  const login = browserLogin({
    api: 'http://127.0.0.1:1',
    dashboard: 'https://dashboard.paysum.io',
    onAuthorize: opened,
  })
  const denied = assert.rejects(login, /cancelled/)
  const url = new URL(await authorize)
  const callback = new URL(url.searchParams.get('redirect_uri'))
  callback.search = new URLSearchParams({ state: url.searchParams.get('state'), error: 'access_denied' })
  assert.equal((await fetch(callback)).status, 200)
  await denied
})
