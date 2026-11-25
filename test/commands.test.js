import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const bin = fileURLToPath(new URL('../bin/paysum.js', import.meta.url))
const exec = promisify(execFile)

test('select a saved store, scaffold and check a theme, and plan a push without writes', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'paysum-cli-test-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))
  const hits = []
  const remotePaths = ['assets/oversized.css', 'assets/deleted.css']
  const server = http.createServer((request, response) => {
    hits.push([request.method, request.url, request.headers.authorization])
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/api/store-api/store') {
      response.end(JSON.stringify({
        id: 'store-b',
        name: 'Second store',
        slug: 'second',
        url: 'https://second.mypaysum.io',
        api_key: { permissions: ['store:read'] },
      }))
    } else if (request.url === '/api/store-api/theme/files?content=false') {
      response.end(JSON.stringify({
        source: 'template_files',
        files: remotePaths.map((path) => ({ path, sha256: 'synced' })),
      }))
    } else {
      response.writeHead(404).end('{}')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const api = `http://127.0.0.1:${server.address().port}`
  const credentialsPath = path.join(cwd, 'credentials.json')
  fs.writeFileSync(credentialsPath, JSON.stringify({
    current: 'store-a',
    stores: {
      'store-a': { key: 'sk_first', name: 'First store', api },
      'store-b': { key: 'sk_second', name: 'Second store', api },
    },
  }))
  const env = { ...process.env, PAYSUM_CONFIG_DIR: cwd, PAYSUM_API_KEY: '', PAYSUM_API_URL: '' }
  const cli = (args, root = cwd, extraEnv = {}) =>
    exec(process.execPath, [bin, ...args], { cwd: root, env: { ...env, ...extraEnv } })
  assert.match((await cli(['list-ids'])).stdout, /store-a\s+default/)
  await assert.rejects(cli(['login']), /Browser sign-in needs an interactive terminal/)
  await cli(['use', 'store-b'])
  assert.match((await cli(['stores'])).stdout, /store-b\s+default/)
  await cli(['create', 'work', '--name', 'My Theme', '--store', 'store-b'], cwd, {
    PAYSUM_API_KEY: 'sk_ignore_env_when_store_is_explicit',
  })
  const root = path.join(cwd, 'work')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'paysum.json'))).store, 'store-b')
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config/theme.json'))).slug, 'my-theme')
  await assert.rejects(cli(['create', 'work']), /folder already exists/)
  await assert.rejects(cli(['create', 'nested'], root), /outside the existing theme project/)
  assert.match((await cli(['files'], root)).stdout, /templates\/product\.liquid/)
  assert.match((await cli(['check'], root)).stdout, /passed local checks/)
  await assert.rejects(cli(['files', '--remote', '--store', 'store-a'], root), /different store/)
  assert.match((await cli(['files', '--remote'], root)).stdout, /assets\/deleted\.css/)

  fs.writeFileSync(path.join(root, remotePaths[0]), Buffer.alloc(512 * 1024 + 1))
  fs.mkdirSync(path.join(root, '.paysum'))
  const state = JSON.stringify({ files: Object.fromEntries(remotePaths.map((path) => [path, 'synced'])) })
  const statePath = path.join(root, '.paysum/state.json')
  fs.writeFileSync(statePath, state)
  await assert.rejects(cli(['check'], root), /oversized\.css exceeds the upload limit/)
  const { stdout } = await cli(['push', '--dry-run'], root)
  assert.match(stdout, /Upload\s+config\/theme\.json/)
  assert.match(stdout, /Delete\s+assets\/deleted\.css/)
  assert.doesNotMatch(stdout, /Delete\s+assets\/oversized\.css/)
  assert.equal(fs.readFileSync(statePath, 'utf8'), state)
  await assert.rejects(cli(['apply', '--dry-run'], root), /only available on paysum push/)
  assert.match((await cli(['login', '--key', 'sk_second', '--api', api])).stdout, /Signed in to Second store/)
  assert.ok(hits.length)
  assert.ok(hits.every(([method, , authorization]) => method === 'GET' && authorization === 'Bearer sk_second'))
})
