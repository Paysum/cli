import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const PROJECT_FILE = 'paysum.json'
const STATE_DIR = '.paysum'
const STATE_FILE = 'state.json'
const MAX_FILE_BYTES = 512 * 1024

const ALLOWED =
  /\.(svelte|liquid|tsx|ts|jsx|js|mjs|css|json|html|md|svg|txt|webmanifest|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico)$/
const BINARY = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico)$/
const BINARY_PREFIX = 'data:application/octet-stream;base64,'
const SAFE_PATH = /^[\w\-./@]+$/
const IGNORED_DIRS = new Set(['node_modules', '.git', STATE_DIR, 'dist', 'build', '.next', '.turbo'])
const IGNORED_FILES = new Set([PROJECT_FILE, 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])
const GENERATED = new Set(['src/data/store.json'])

export const sha256 = (content) => createHash('sha256').update(content).digest('hex')

export function isThemePath(relative) {
  if (!relative || relative.length > 200 || !SAFE_PATH.test(relative)) return false
  const parts = relative.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.')))
    return false
  if (IGNORED_DIRS.has(parts[0]) || parts.some((part) => IGNORED_DIRS.has(part))) return false
  if (parts.length === 1 && IGNORED_FILES.has(parts[0])) return false
  if (GENERATED.has(relative)) return false
  return ALLOWED.test(relative)
}

export function findProject(start = process.cwd()) {
  let dir = path.resolve(start)
  while (true) {
    const file = path.join(dir, PROJECT_FILE)
    if (fs.existsSync(file)) {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'))
      return { root: dir, config }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function writeProject(root, config) {
  fs.writeFileSync(path.join(root, PROJECT_FILE), `${JSON.stringify(config, null, 2)}\n`)
}

export function readState(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, STATE_DIR, STATE_FILE), 'utf8')).files ?? {}
  } catch {
    return {}
  }
}

export function writeState(root, files) {
  const dir = path.join(root, STATE_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(
    path.join(dir, STATE_FILE),
    `${JSON.stringify({ version: 1, files: sorted }, null, 2)}\n`,
  )
}

const toPosix = (value) => value.split(path.sep).join('/')

function readThemeFile(absolute, relative) {
  if (fs.statSync(absolute).size > MAX_FILE_BYTES) return 'oversized'
  const content = BINARY.test(relative)
    ? BINARY_PREFIX + fs.readFileSync(absolute).toString('base64')
    : fs.readFileSync(absolute, 'utf8')
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) return 'oversized'
  return { content, hash: sha256(content) }
}

export function scanLocal(root) {
  const files = {}
  const oversized = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const relative = toPosix(path.relative(root, absolute))
      if (!isThemePath(relative)) continue
      const file = readThemeFile(absolute, relative)
      if (file === 'oversized') oversized.push(relative)
      else files[relative] = file
    }
  }
  walk(root)
  return { files, oversized }
}

export function readLocalFile(root, relative) {
  const absolute = path.join(root, relative)
  try {
    if (!fs.statSync(absolute).isFile()) return null
    const file = readThemeFile(absolute, relative)
    return file === 'oversized' ? null : file
  } catch {
    return null
  }
}

export function writeLocalFile(root, relative, content) {
  const absolute = path.join(root, relative)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  const binary = BINARY.test(relative) && content.startsWith(BINARY_PREFIX)
  fs.writeFileSync(
    absolute,
    binary ? Buffer.from(content.slice(BINARY_PREFIX.length), 'base64') : content,
  )
}

export function removeLocalFile(root, relative) {
  fs.rmSync(path.join(root, relative), { force: true })
  let dir = path.dirname(path.join(root, relative))
  while (dir.startsWith(root) && dir !== root) {
    if (fs.readdirSync(dir).length) break
    fs.rmdirSync(dir)
    dir = path.dirname(dir)
  }
}

export function planPush(local, state, remote = null) {
  const upload = []
  const remove = []
  const conflicts = []
  for (const [file, { hash }] of Object.entries(local)) {
    if (state[file] === hash) continue
    if (remote && remote[file] && remote[file] !== state[file] && remote[file] !== hash)
      conflicts.push(file)
    else upload.push(file)
  }
  for (const file of Object.keys(state)) {
    if (local[file]) continue
    if (remote && remote[file] && remote[file] !== state[file]) conflicts.push(file)
    else if (!remote || remote[file]) remove.push(file)
  }
  return { upload: upload.sort(), remove: remove.sort(), conflicts: conflicts.sort() }
}

export function planPull(local, state, remote, { force = false } = {}) {
  const write = []
  const remove = []
  const conflicts = []
  for (const [file, hash] of Object.entries(remote)) {
    const mine = local[file]?.hash
    if (mine === hash) continue
    const editedLocally = mine !== undefined && mine !== state[file]
    if (editedLocally && !force) conflicts.push(file)
    else write.push(file)
  }
  for (const file of Object.keys(state)) {
    if (remote[file] || !local[file]) continue
    const editedLocally = local[file].hash !== state[file]
    if (editedLocally && !force) conflicts.push(file)
    else remove.push(file)
  }
  return { write: write.sort(), remove: remove.sort(), conflicts: conflicts.sort() }
}
