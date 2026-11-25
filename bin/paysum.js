#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { VERSION } from '../src/api.js'
import * as commands from '../src/commands.js'
import { c, fail, line } from '../src/ui.js'

const BANNER = [
  '██████╗  █████╗ ██╗   ██╗███████╗██╗   ██╗███╗   ███╗     ██████╗██╗     ██╗',
  '██╔══██╗██╔══██╗╚██╗ ██╔╝██╔════╝██║   ██║████╗ ████║    ██╔════╝██║     ██║',
  '██████╔╝███████║ ╚████╔╝ ███████╗██║   ██║██╔████╔██║    ██║     ██║     ██║',
  '██╔═══╝ ██╔══██║  ╚██╔╝  ╚════██║██║   ██║██║╚██╔╝██║    ██║     ██║     ██║',
  '██║     ██║  ██║   ██║   ███████║╚██████╔╝██║ ╚═╝ ██║    ╚██████╗███████╗██║',
  '╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚═════╝ ╚═╝     ╚═╝     ╚═════╝╚══════╝╚═╝',
]

const GROUPS = {
  Stores: {
    login: { run: commands.login, summary: 'Save a store API key' },
    logout: { run: commands.logout, summary: 'Remove a saved store key' },
    stores: { run: commands.stores, summary: 'List saved store IDs' },
    use: { run: commands.use, summary: 'Set the default store', args: '<store-id>' },
    whoami: { run: commands.whoami, summary: 'Show the current store and key scopes' },
  },
  Themes: {
    create: { run: commands.create, summary: 'Create a local Liquid starter', args: '[folder]' },
    init: { run: commands.init, summary: 'Download an existing theme', args: '[folder]' },
    'theme-port': { run: commands.themePort, summary: 'Convert a SellAuth ZIP without publishing', args: '<theme.zip>' },
    files: { run: commands.files, summary: 'List local files or remote drafts (--remote)' },
    check: { run: commands.check, summary: 'Check required files, sizes and manifest' },
    status: { run: commands.status, summary: 'List changes since the last sync' },
    pull: { run: commands.pull, summary: 'Bring server changes into this folder' },
    push: { run: commands.push, summary: 'Upload drafts or show the plan (--dry-run)' },
  },
  Release: {
    watch: { run: commands.watch, summary: 'Push on save and reload the preview' },
    preview: { run: commands.preview, summary: 'Get a link to the saved drafts' },
    publish: { run: commands.publish, summary: 'Publish drafts (alias: apply)' },
    versions: { run: commands.versions, summary: 'List published versions' },
    open: { run: commands.open, summary: 'Open the live storefront' },
  },
}

const COMMANDS = Object.assign(Object.create(null), ...Object.values(GROUPS))
const ALIASES = Object.assign(Object.create(null), {
  ls: 'versions', deploy: 'publish', apply: 'publish', dev: 'watch', info: 'whoami', 'list-ids': 'stores',
})

const OPTIONS = {
  key: { type: 'string' },
  api: { type: 'string' },
  store: { type: 'string' },
  name: { type: 'string' },
  remote: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  force: { type: 'boolean', short: 'f' },
  yes: { type: 'boolean', short: 'y' },
  open: { type: 'boolean', short: 'o' },
  'no-push': { type: 'boolean' },
  out: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
}

function help() {
  const columns = process.stdout.columns
  line()
  if (!columns || BANNER.every((row) => row.length + 2 <= columns)) {
    for (const row of BANNER) line(row)
    line()
  }
  line(`${c.bold('Paysum CLI')}  v${VERSION}  Build storefront themes locally`)
  line()
  line(c.bold('Usage'))
  line('  paysum <command> [options]')
  line()
  for (const [group, commands] of Object.entries(GROUPS)) {
    line(c.bold(group))
    for (const [name, cmd] of Object.entries(commands)) {
      helpRow(cmd.args ? `${name} ${cmd.args}` : name, cmd.summary)
    }
    line()
  }
  line(c.bold('Options'))
  helpRow('--key <sk_...>', 'Use this key instead of PAYSUM_API_KEY or your saved key')
  helpRow('--api <url>', 'API origin (default https://paysum.io)')
  helpRow('--store <id>', 'Use the saved key for this store')
  helpRow('--name <name>', 'Name the local theme created by create')
  helpRow('--out <file.zip>', 'Save the converted ZIP from theme-port')
  helpRow('-o, --open', 'Open the preview or storefront in your browser')
  helpRow('-f, --force', 'Overwrite conflicts or init into a non-empty folder')
  helpRow('-y, --yes', 'Publish without asking')
  helpRow('--no-push', 'Publish the drafts already on the server')
  helpRow('-h, --help', 'Show this help')
  helpRow('-v, --version', 'Show the CLI version')
  line()
  line(c.bold('Quick Start'))
  line('  $ paysum login')
  line('  $ paysum init my-theme && cd my-theme')
  line('  $ paysum watch --open')
  line()
}

function helpRow(label, summary) {
  line(`  ${label.padEnd(23)}${summary}`)
}

async function main() {
  let parsed
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    fail(error.message.split('. ')[0], 'Run `paysum --help` to see every option.')
    return 2
  }
  const { values: flags, positionals } = parsed
  if (flags.version) {
    console.log(VERSION)
    return 0
  }
  const [name, ...rest] = positionals
  if (!name || flags.help || name === 'help') {
    help()
    return 0
  }
  const canonical = ALIASES[name] ?? name
  const command = COMMANDS[canonical]
  if (!command) {
    fail(`Unknown command: ${name}`, 'Run `paysum --help` to see every command.')
    return 2
  }
  for (const [option, expected] of [['dry-run', 'push'], ['remote', 'files'], ['name', 'create']]) {
    if (flags[option] !== undefined && canonical !== expected) {
      fail(`--${option} is only available on paysum ${expected}.`)
      return 2
    }
  }
  if (flags.store !== undefined && (!flags.store.trim() || flags.key !== undefined || canonical === 'login')) {
    fail('--store needs a saved store ID. Do not combine it with --key or login.')
    return 2
  }
  try {
    await command.run(flags, rest)
    return 0
  } catch (error) {
    const reason = commands.explain(error)
    if (reason instanceof commands.CliError) {
      fail(reason.message, reason.help)
      return 1
    }
    fail(reason?.message || String(reason))
    if (process.env.DEBUG) console.error(reason)
    return 1
  }
}

process.exitCode = await main()
