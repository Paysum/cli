import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ApiError, createClient } from './api.js'
import {
  DEFAULT_API,
  readCredentials,
  removeLogin,
  resolveAuth,
  saveLogin,
  writeCredentials,
} from './config.js'
import {
  findProject,
  isThemePath,
  planPull,
  planPush,
  readLocalFile,
  readState,
  removeLocalFile,
  scanLocal,
  sha256,
  writeLocalFile,
  writeProject,
  writeState,
} from './project.js'
import { starterFiles, themeProblems } from './starter.js'
import * as ui from './ui.js'

const { c, symbols } = ui

export class CliError extends Error {
  constructor(message, help) {
    super(message)
    this.help = help
  }
}

const host = (url) => (url ? url.replace(/^https?:\/\//, '') : '')
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

function openUrl(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
  }
}

export function explain(error) {
  if (!(error instanceof ApiError)) return error
  if (error.status === 401)
    return new CliError(error.message, 'Run `paysum login` with a valid API key.')
  if (error.status === 403)
    return new CliError(
      error.message,
      'Check the required scope in Dashboard → Developers → API keys.',
    )
  if (error.status === 429) return new CliError(error.message, 'Wait a little and try again.')
  return new CliError(error.message)
}

function session(flags, project = null) {
  if (flags.store && project?.config.store && flags.store !== project.config.store)
    throw new CliError('This folder belongs to a different store.')
  const auth = resolveAuth({
    key: flags.key,
    api: flags.api ?? project?.config.api,
    storeId: flags.store ?? project?.config.store,
    savedOnly: flags.store !== undefined,
  })
  if (!auth) {
    throw new CliError(
      project ? 'You are not signed in to the store this folder belongs to.' : 'You are not signed in.',
      'Run `paysum login`, or set PAYSUM_API_KEY.',
    )
  }
  return { ...auth, client: createClient(auth) }
}

export async function themePort(flags, args) {
  const [input] = args
  if (args.length !== 1 || !input?.toLowerCase().endsWith('.zip'))
    throw new CliError('Provide one SellAuth theme ZIP.', 'Run `paysum theme-port theme.zip [--out liquid.zip]`.')
  const source = fs.statSync(input)
  if (!source.isFile() || source.size === 0 || source.size > 1536 * 1024)
    throw new CliError('The input must be a non-empty ZIP of at most 1.5 MiB.')

  const { client } = session(flags, findProject())
  const { archive_base64: archive, ...result } = await client
    .portTheme(fs.readFileSync(input).toString('base64'), flags.out !== undefined)
    .catch((error) => {
      if (error instanceof ApiError && error.status === 404 && error.code === 'not_found')
        throw new CliError('Theme conversion is not available on this Paysum API yet.')
      throw error
    })
  if (flags.out !== undefined) {
    if (typeof archive !== 'string' || !archive)
      throw new CliError('The API did not return a converted ZIP.')
    try {
      fs.writeFileSync(flags.out, Buffer.from(archive, 'base64'), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (error.code === 'EEXIST') throw new CliError('The output file already exists. Pick a new path.')
      throw error
    }
  }
  console.log(JSON.stringify(result, null, 2))
}

function requireProject() {
  const project = findProject()
  if (!project)
    throw new CliError(
      'This folder is not an Paysum theme.',
      'Run `paysum init` to download your theme, then work inside that folder.',
    )
  return project
}

function assertSameStore(project, store) {
  if (project.config.store && project.config.store !== store.id)
    throw new CliError(
      `This folder belongs to ${project.config.name || project.config.store}, but the key is for ${store.name}.`,
      'Sign in to the right store with `paysum login`, or pass --key.',
    )
}

const remoteHashes = (files) => Object.fromEntries(files.map((file) => [file.path, file.sha256]))

export async function login(flags) {
  ui.heading('Paysum', 'sign in')
  let key = flags.key || process.env.PAYSUM_API_KEY
  if (!key) {
    ui.hint('Create a key in Dashboard → Developers → API keys.')
    ui.hint('Give it themes:write to push and publish, or store:read to look around.')
    ui.line()
    key = await ui.ask('API key', { secret: true })
  }
  if (!key?.startsWith('sk_'))
    throw new CliError('That does not look like an API key.', 'Keys start with sk_.')
  const api = flags.api || process.env.PAYSUM_API_URL || DEFAULT_API
  const spin = ui.spinner('Checking key')
  let store
  try {
    store = await createClient({ key, api }).store()
  } catch (error) {
    if (error instanceof ApiError && error.status === 403)
      throw new CliError(
        'The key works, but it cannot read store details.',
        'Add the store:read scope (or any :write scope) to the key.',
      )
    throw error
  } finally {
    spin.stop()
  }
  const file = saveLogin(store, key, api)
  ui.success(`Signed in to ${c.bold(store.name)} ${c.gray(host(store.url))}`)
  ui.line()
  ui.rows([
    ['Scopes', store.api_key.permissions.join(', ') || 'none'],
    ['Saved to', file],
  ])
  ui.line()
  ui.hint('Next: `paysum init` downloads the theme into a new folder.')
  ui.line()
}

export async function logout(flags) {
  const credentials = readCredentials()
  const project = findProject()
  const id = flags.store || project?.config.store || credentials.current
  if (!id || !Object.hasOwn(credentials.stores, id)) {
    ui.line()
    ui.line('You are not signed in.')
    ui.line()
    return
  }
  const removed = removeLogin(id)
  ui.line()
  ui.success(`Signed out of ${c.bold(removed.name)}. The key itself still works until you revoke it.`)
  ui.line()
}

export function stores() {
  const credentials = readCredentials()
  const entries = Object.entries(credentials.stores)
  if (!entries.length) {
    ui.hint('No saved stores. Run `paysum login` to add one.')
    return
  }
  ui.table([
    ['STORE', 'ID', ''],
    ...entries.map(([id, store]) => [store.name, id, id === credentials.current ? 'default' : '']),
  ])
}

export function use(_flags, args) {
  const [id] = args
  if (args.length !== 1) throw new CliError('Provide one store ID from `paysum stores`.')
  const credentials = readCredentials()
  if (!Object.hasOwn(credentials.stores, id))
    throw new CliError('No saved key for that store. Run `paysum login` to add one.')
  credentials.current = id
  writeCredentials(credentials)
  ui.success(`Default store: ${credentials.stores[id].name}. Theme folders keep their own store.`)
}

export async function whoami(flags) {
  const project = findProject()
  const { client, api } = session(flags, project)
  const spin = ui.spinner('Loading store')
  const store = await client.store().finally(() => spin.stop())
  const credentials = readCredentials()
  ui.heading(store.name, host(store.url))
  ui.rows([
    ['Store ID', store.id],
    ['Currency', store.currency],
    ['Products', String(store.product_count)],
    ['Scopes', store.api_key.permissions.join(', ') || 'none'],
    ['API', api],
    ...(project ? [['Theme folder', project.root]] : []),
  ])
  const others = Object.entries(credentials.stores).filter(([id]) => id !== store.id)
  if (others.length) {
    ui.line()
    ui.hint(`Also signed in to ${others.map(([, saved]) => saved.name).join(', ')}.`)
  }
  ui.line()
}

function projectDestination(target) {
  const root = path.resolve(target)
  if (findProject(path.dirname(root)))
    throw new CliError('Choose a folder outside the existing theme project.')
  return root
}

export async function init(flags, [target]) {
  const { client, api } = session(flags)
  const spin = ui.spinner('Downloading theme')
  let store
  let theme
  try {
    ;[store, theme] = await Promise.all([client.store(), client.files(true)])
  } finally {
    spin.stop()
  }
  const root = projectDestination(target || store.slug || 'paysum-theme')
  if (fs.existsSync(root) && fs.readdirSync(root).length && !flags.force)
    throw new CliError(
      `${path.relative(process.cwd(), root) || '.'} is not empty.`,
      'Pick another folder, or pass --force to download into it anyway.',
    )
  fs.mkdirSync(root, { recursive: true })
  const state = {}
  for (const file of theme.files) {
    if (!isThemePath(file.path)) continue
    writeLocalFile(root, file.path, file.content)
    state[file.path] = sha256(file.content)
  }
  writeProject(root, {
    store: store.id,
    name: store.name,
    ...(api === DEFAULT_API ? {} : { api }),
  })
  writeState(root, state)
  const gitignore = path.join(root, '.gitignore')
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, 'node_modules/\n.paysum/\n')

  const relative = path.relative(process.cwd(), root) || '.'
  ui.line()
  ui.success(`Downloaded ${plural(Object.keys(state).length, 'file')} from ${c.bold(store.name)}`)
  ui.line()
  ui.rows([
    ['Folder', relative],
    ['Source', theme.source === 'template_files' ? 'saved drafts' : `${theme.source.replace(/_/g, ' ')}`],
  ])
  ui.line()
  ui.line(c.gray('Next'))
  if (relative !== '.') ui.line(`  cd ${relative}`)
  ui.line(`  paysum watch     ${c.gray('live preview while you edit')}`)
  ui.line(`  paysum publish   ${c.gray('make it live')}`)
  ui.line()
}

export async function create(flags, args) {
  if (args.length > 1) throw new CliError('Provide one folder for the starter theme.')
  const name = flags.name?.trim() || (args[0] ? path.basename(path.resolve(args[0])) : 'Starter')
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63)
  if (!slug) throw new CliError('Use a theme name with at least one letter or number.')
  const root = projectDestination(args[0] || slug)
  if (fs.existsSync(root)) throw new CliError('The folder already exists. Choose a new folder.')
  if (!fs.existsSync(path.dirname(root))) throw new CliError('The parent folder must exist.')
  const { client, api } = session(flags)
  const store = await client.store()
  fs.mkdirSync(root)
  for (const [relative, content] of Object.entries(starterFiles(name, slug))) {
    writeLocalFile(root, relative, content)
  }
  writeProject(root, {
    store: store.id,
    name: store.name,
    ...(api === DEFAULT_API ? {} : { api }),
  })
  fs.writeFileSync(path.join(root, '.gitignore'), '.paysum/\nnode_modules/\n')
  ui.success(`Created ${name} in ${path.relative(process.cwd(), root)}. No drafts changed.`)
  ui.hint('Run `paysum check` in the new folder, then `paysum push --dry-run` to see conflicts.')
}

export async function files(flags) {
  if (flags.remote) {
    const project = findProject()
    const { client } = session(flags, project)
    if (project) assertSameStore(project, await client.store())
    const theme = await client.files(false)
    ui.heading('Remote files', theme.source.replace(/_/g, ' '))
    for (const file of theme.files.map(({ path }) => path).sort()) ui.line(file)
    return
  }
  const { files: local, oversized } = scanLocal(requireProject().root)
  for (const file of Object.keys(local).sort()) ui.line(file)
  for (const file of oversized.sort()) ui.warn(`${file} exceeds the upload limit`)
}

export function check() {
  const { files: local, oversized } = scanLocal(requireProject().root)
  const problems = [
    ...oversized.map((file) => `${file} exceeds the upload limit`),
    ...themeProblems(local),
  ]
  if (problems.length) throw new CliError(problems.join('\n'))
  ui.success('Theme files and manifest passed local checks.')
  ui.hint('Use `paysum preview` to check how saved drafts render.')
}

export async function pull(flags) {
  const project = requireProject()
  const { client } = session(flags, project)
  const spin = ui.spinner('Fetching theme')
  let store
  let theme
  try {
    ;[store, theme] = await Promise.all([client.store(), client.files(true)])
  } finally {
    spin.stop()
  }
  assertSameStore(project, store)
  const remoteFiles = theme.files.filter((file) => isThemePath(file.path))
  const remote = remoteHashes(remoteFiles)
  const contents = Object.fromEntries(remoteFiles.map((file) => [file.path, file.content]))
  const { files: local } = scanLocal(project.root)
  const state = readState(project.root)
  const plan = planPull(local, state, remote, { force: flags.force })

  ui.line()
  for (const file of plan.write) {
    writeLocalFile(project.root, file, contents[file])
    state[file] = remote[file]
    ui.line(`${symbols.down} ${file}`)
  }
  for (const file of plan.remove) {
    removeLocalFile(project.root, file)
    delete state[file]
    ui.line(`${symbols.remove} ${file}`)
  }
  for (const [file, hash] of Object.entries(remote)) if (local[file]?.hash === hash) state[file] = hash
  writeState(project.root, state)

  if (!plan.write.length && !plan.remove.length && !plan.conflicts.length) {
    ui.success('Already up to date')
  } else if (plan.write.length || plan.remove.length) {
    ui.line()
    ui.success(`Pulled ${plural(plan.write.length, 'file')}${plan.remove.length ? `, removed ${plan.remove.length}` : ''}`)
  }
  if (plan.conflicts.length) {
    ui.line()
    ui.warn(`Kept your local edits to ${plural(plan.conflicts.length, 'file')}:`)
    for (const file of plan.conflicts) ui.line(`  ${c.yellow(file)}`)
    ui.hint('Push them, or run `paysum pull --force` to take the server version.')
  }
  ui.line()
}

export async function status() {
  const project = requireProject()
  const { files: local, oversized } = scanLocal(project.root)
  const plan = planPush(local, readState(project.root))
  ui.heading(project.config.name || 'Theme', project.root)
  if (!plan.upload.length && !plan.remove.length) ui.success('No local changes')
  for (const file of plan.upload) ui.line(`${symbols.up} ${file}`)
  for (const file of plan.remove) ui.line(`${symbols.remove} ${file}`)
  for (const file of oversized) ui.warn(`${file} is over 512 KB and will not be uploaded`)
  ui.line()
}

async function pushChanges(project, client, flags, { quiet = false } = {}) {
  const { files: local, oversized } = scanLocal(project.root)
  const state = readState(project.root)
  for (const file of oversized) if (state[file]) local[file] = { hash: state[file] }
  const theme = await client.files(false)
  const remote = remoteHashes(theme.files)
  const plan = planPush(local, state, flags.force ? null : remote)
  for (const file of Object.keys(state)) if (!local[file] && !remote[file]) delete state[file]
  if (plan.conflicts.length) {
    ui.warn(`${plural(plan.conflicts.length, 'file')} changed on the server since your last sync:`)
    for (const file of plan.conflicts) ui.line(`  ${c.yellow(file)}`)
    throw new CliError(
      'Push stopped so nothing gets overwritten.',
      'Run `paysum pull` to merge, or `paysum push --force` to overwrite.',
    )
  }
  for (const file of oversized) ui.warn(`${file} is over 512 KB and was skipped`)
  if (flags['dry-run']) {
    for (const file of plan.upload) ui.line(`Upload  ${file}`)
    for (const file of plan.remove) ui.line(`Delete  ${file}`)
    ui.success('Dry run complete. No drafts or local sync state changed.')
    return
  }
  if (!plan.upload.length && !plan.remove.length) {
    writeState(project.root, state)
    if (!quiet) ui.success('Nothing to push')
    return { uploaded: 0, removed: 0 }
  }
  const started = Date.now()
  await client.writeFiles(
    plan.upload.map((file) => ({ path: file, content: local[file].content })),
    plan.remove,
  )
  for (const file of plan.upload) {
    state[file] = local[file].hash
    ui.line(`${symbols.up} ${file}`)
  }
  for (const file of plan.remove) {
    delete state[file]
    ui.line(`${symbols.remove} ${file}`)
  }
  writeState(project.root, state)
  ui.line()
  ui.success(
    `Pushed ${plural(plan.upload.length, 'file')}${plan.remove.length ? `, deleted ${plan.remove.length}` : ''} ${c.gray(`${Date.now() - started}ms`)}`,
  )
  return { uploaded: plan.upload.length, removed: plan.remove.length }
}

export async function push(flags) {
  const project = requireProject()
  const { client } = session(flags, project)
  assertSameStore(project, await client.store())
  ui.line()
  await pushChanges(project, client, flags)
  if (!flags['dry-run']) ui.hint('Drafts are saved. Run `paysum publish` to make them live.')
  ui.line()
}

export async function preview(flags) {
  const project = requireProject()
  const { client } = session(flags, project)
  const link = await client.preview()
  ui.line()
  ui.rows([
    ['Preview', c.cyan(link.url)],
    ['Expires', new Date(link.expires_at).toLocaleString()],
  ])
  ui.line()
  ui.hint('The page renders your saved drafts and reloads when they change.')
  ui.line()
  if (flags.open) openUrl(link.url)
}

export async function watch(flags) {
  const project = requireProject()
  const { client } = session(flags, project)
  const spin = ui.spinner('Syncing')
  let store
  try {
    store = await client.store()
    assertSameStore(project, store)
  } finally {
    spin.stop()
  }
  ui.heading(store.name, 'watching for changes')
  await pushChanges(project, client, flags, { quiet: true })
  const link = await client.preview()
  ui.rows([
    ['Preview', c.cyan(link.url)],
    ['Folder', project.root],
  ])
  ui.line()
  ui.hint('Saves are pushed as drafts and the preview reloads. Ctrl+C to stop.')
  ui.line()
  if (flags.open) openUrl(link.url)

  const pending = new Set()
  let timer = null
  let running = Promise.resolve()

  const flush = async () => {
    const paths = [...pending]
    pending.clear()
    const state = readState(project.root)
    const upload = []
    const remove = []
    for (const file of paths) {
      const current = readLocalFile(project.root, file)
      if (current && current.hash !== state[file]) upload.push({ path: file, ...current })
      if (!current && state[file]) remove.push(file)
    }
    if (!upload.length && !remove.length) return
    const started = Date.now()
    try {
      await client.writeFiles(
        upload.map((file) => ({ path: file.path, content: file.content })),
        remove,
      )
      for (const file of upload) state[file.path] = file.hash
      for (const file of remove) delete state[file]
      writeState(project.root, state)
      const took = c.gray(`${Date.now() - started}ms`)
      for (const file of upload) ui.line(`${ui.time()}  ${symbols.up} ${file.path}  ${took}`)
      for (const file of remove) ui.line(`${ui.time()}  ${symbols.remove} ${file}  ${took}`)
    } catch (error) {
      const reason = explain(error)
      ui.line(`${ui.time()}  ${symbols.fail} ${reason.message}`)
      for (const file of [...upload.map((entry) => entry.path), ...remove]) pending.add(file)
    }
  }

  const watcher = fs.watch(project.root, { recursive: true }, (_event, name) => {
    if (!name) return
    const relative = name.split(path.sep).join('/')
    if (!isThemePath(relative)) return
    pending.add(relative)
    clearTimeout(timer)
    timer = setTimeout(() => {
      running = running.then(flush)
    }, 150)
  })

  await new Promise((resolve) => {
    process.once('SIGINT', () => {
      watcher.close()
      clearTimeout(timer)
      running.then(() => {
        ui.line()
        ui.hint('Stopped watching. Run `paysum publish` when you are ready to go live.')
        ui.line()
        resolve()
      })
    })
  })
}

export async function publish(flags) {
  const project = requireProject()
  const { client } = session(flags, project)
  const store = await client.store()
  assertSameStore(project, store)
  ui.line()
  if (!flags['no-push']) await pushChanges(project, client, flags, { quiet: true })
  if (!flags.yes) {
    if (!ui.isInteractive())
      throw new CliError('Publishing needs confirmation.', 'Pass --yes to publish without a prompt.')
    if (!(await ui.confirm(`Publish the drafts to ${c.bold(store.name)}?`))) {
      ui.line('Nothing published.')
      ui.line()
      return
    }
  }
  const spin = ui.spinner('Building theme')
  const result = await client.publish().finally(() => spin.stop())
  ui.success(`Version ${c.bold(String(result.version))} is live ${c.gray(`built in ${result.build_ms}ms`)}`)
  ui.line()
  ui.rows([['Storefront', c.cyan(store.url)]])
  ui.line()
  if (flags.open) openUrl(store.url)
}

export async function versions(flags) {
  const project = findProject()
  const { client } = session(flags, project)
  const data = await client.versions()
  ui.line()
  if (!data.versions.length) {
    ui.line('Nothing published yet. Run `paysum publish` to ship your first version.')
    ui.line()
    return
  }
  ui.table([
    ['VERSION', 'PUBLISHED', ''],
    ...data.versions.map((version) => [
      String(version.version),
      new Date(version.published_at).toLocaleString(),
      version.version === data.live_version ? c.green('live') : version.restored_from ? c.gray('restored') : '',
    ]),
  ])
  ui.line()
}

export async function open(flags) {
  const project = findProject()
  const { client } = session(flags, project)
  const store = await client.store()
  ui.line()
  ui.line(`Opening ${c.cyan(store.url)}`)
  ui.line()
  openUrl(store.url)
}
