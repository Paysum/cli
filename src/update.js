import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION } from './api.js'
import { configDir } from './config.js'

const githubApi = 'https://api.github.com/repos/Paysum/cli'
const daily = 24 * 60 * 60_000
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/
const packageRoot = fileURLToPath(new URL('..', import.meta.url))

async function githubJson(route, fetcher, timeoutMs) {
  const response = await fetcher(`${githubApi}${route}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `paysum-cli/${VERSION}` },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`Could not check GitHub releases (HTTP ${response.status}).`)
  return response.json()
}

export async function latestVersion({ fetcher = fetch, timeoutMs = 5000 } = {}) {
  const release = await githubJson('/releases/latest', fetcher, timeoutMs)
  const version = typeof release?.tag_name === 'string' && release.tag_name.startsWith('v')
    ? release.tag_name.slice(1)
    : ''
  if (!versionPattern.test(version) || release.draft || release.prerelease)
    throw new Error('GitHub did not return a stable Paysum CLI version.')
  const current = VERSION.split('.').map(Number)
  for (const [index, part] of version.split('.').map(Number).entries()) {
    if (part !== current[index]) return part > current[index] ? version : null
  }
  return null
}

export async function releaseArchive(version, fetcher = fetch) {
  if (!versionPattern.test(version)) throw new Error('Invalid Paysum CLI version.')
  const commit = await githubJson(`/commits/v${version}`, fetcher, 5000)
  if (typeof commit?.sha !== 'string' || !/^[a-f0-9]{40}$/.test(commit.sha))
    throw new Error('GitHub did not return a valid release commit.')
  return `https://github.com/Paysum/cli/archive/${commit.sha}.tar.gz`
}

export function installUpdate(archive) {
  const args = process.platform === 'win32'
    ? [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : []
  const npm = args.length ? process.execPath : 'npm'
  const root = spawnSync(npm, [...args, 'root', '--global'], { encoding: 'utf8', timeout: 5000 })
  if (root.status !== 0 || !root.stdout?.trim()) return false
  try {
    if (fs.realpathSync(path.join(root.stdout.trim(), '@paysum_io', 'cli')) !== fs.realpathSync(packageRoot))
      return false
  } catch {
    return false
  }
  const install = spawnSync(npm, [...args, 'install', '--global', '--ignore-scripts', archive], {
    stdio: 'inherit',
  })
  if (install.status !== 0) throw new Error('npm could not install the update.')
  return true
}

export async function checkForUpdate() {
  if (!process.stdout.isTTY || !process.stderr.isTTY || process.env.CI ||
      'PAYSUM_NO_UPDATE_CHECK' in process.env) return
  try {
    const dir = configDir()
    const stamp = path.join(dir, 'update-check')
    const last = fs.statSync(stamp, { throwIfNoEntry: false })?.mtimeMs
    if (last && Date.now() - last < daily) return
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(stamp, '', { mode: 0o600 })
    const version = await latestVersion({ timeoutMs: 1000 })
    if (version) process.stderr.write(`\n  Paysum CLI v${version} is available. Run paysum update.\n`)
  } catch {
  }
}
