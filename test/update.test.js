import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VERSION } from '../src/api.js'
import { latestVersion, releaseArchive } from '../src/update.js'

test('only a newer stable release from the official GitHub repo is offered', async () => {
  const newer = `${Number(VERSION.split('.')[0]) + 1}.10.0`
  const result = (tag_name, flags = {}) => async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Paysum/cli/releases/latest')
    assert.equal(options.redirect, 'error')
    return Response.json({ tag_name, ...flags })
  }
  assert.equal(await latestVersion({ fetcher: result(`v${newer}`) }), newer)
  assert.equal(await latestVersion({ fetcher: result(`v${VERSION}`) }), null)
  assert.equal(await latestVersion({ fetcher: result('v0.9.5') }), null)
  await assert.rejects(latestVersion({ fetcher: result(`v${newer}-beta.1`) }), /stable/)
  await assert.rejects(latestVersion({ fetcher: result(`v${newer}`, { draft: true }) }), /stable/)
})

test('updates use the official GitHub archive pinned to a commit', async () => {
  const sha = 'a'.repeat(40)
  const archive = await releaseArchive('2.10.0', async (url) => {
    assert.equal(url, 'https://api.github.com/repos/Paysum/cli/commits/v2.10.0')
    return Response.json({ sha, tarball_url: 'https://other.example/cli.tar.gz' })
  })
  assert.equal(archive, `https://github.com/Paysum/cli/archive/${sha}.tar.gz`)
  await assert.rejects(releaseArchive('2.10.0', async () => Response.json({ sha: 'main' })), /valid release commit/)
})
