import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_API = 'https://paysum.io'

function configDir() {
  if (process.env.PAYSUM_CONFIG_DIR) return process.env.PAYSUM_CONFIG_DIR
  if (process.platform === 'win32' && process.env.APPDATA)
    return path.join(process.env.APPDATA, 'paysum')
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'paysum')
}

const credentialsFile = () => path.join(configDir(), 'credentials.json')

export function readCredentials() {
  try {
    const data = JSON.parse(fs.readFileSync(credentialsFile(), 'utf8'))
    return { current: data.current ?? null, stores: data.stores ?? {} }
  } catch {
    return { current: null, stores: {} }
  }
}

export function writeCredentials(credentials) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 })
  const file = credentialsFile()
  fs.writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return file
}

export function saveLogin(store, key, api) {
  const credentials = readCredentials()
  credentials.stores[store.id] = { key, name: store.name, slug: store.slug, url: store.url, api }
  credentials.current = store.id
  return writeCredentials(credentials)
}

export function removeLogin(storeId) {
  const credentials = readCredentials()
  const removed = credentials.stores[storeId]
  delete credentials.stores[storeId]
  if (credentials.current === storeId) credentials.current = Object.keys(credentials.stores)[0] ?? null
  writeCredentials(credentials)
  return removed
}

export function resolveAuth({ key, api, storeId, savedOnly = false } = {}) {
  const envKey = process.env.PAYSUM_API_KEY
  const envApi = process.env.PAYSUM_API_URL
  if (!savedOnly && (key || envKey))
    return { key: key || envKey, api: api || envApi || DEFAULT_API, storeId }
  const credentials = readCredentials()
  const id = storeId || credentials.current
  const saved = id && Object.hasOwn(credentials.stores, id) ? credentials.stores[id] : null
  if (!saved) return null
  return { key: saved.key, api: api || envApi || saved.api || DEFAULT_API, storeId: id, saved }
}
