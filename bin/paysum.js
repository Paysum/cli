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

const COMMANDS = {
  login: { run: commands.login, summary: 'Sign in with a store API key' },
  logout: { run: commands.logout, summary: 'Forget the saved key for this store' },
  whoami: { run: commands.whoami, summary: 'Show the store and scopes you are using' },
  init: { run: commands.init, summary: 'Download the theme into a new folder', args: '[folder]' },
  'theme-port': { run: commands.themePort, summary: 'Convert a SellAuth ZIP without publishing', args: '<theme.zip>' },
  pull: { run: commands.pull, summary: 'Bring server changes into this folder' },
  status: { run: commands.status, summary: 'List files changed since the last sync' },
  push: { run: commands.push, summary: 'Upload local changes as drafts' },
  watch: { run: commands.watch, summary: 'Push on save with a live preview link' },
  preview: { run: commands.preview, summary: 'Get a preview link for the current drafts' },
  publish: { run: commands.publish, summary: 'Push, build on the server and go live' },
  versions: { run: commands.versions, summary: 'List published versions' },
  open: { run: commands.open, summary: 'Open the storefront in your browser' },
}

const ALIASES = { ls: 'versions', deploy: 'publish', dev: 'watch', info: 'whoami' }

const OPTIONS = {
  key: { type: 'string' },
  api: { type: 'string' },
  store: { type: 'string' },
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
    for (const row of BANNER) line(c.cyan(row))
    line()
  }
  line(`${c.bold('Paysum CLI')}  ${c.gray(`v${VERSION}`)}  Build storefront themes locally`)
  line()
  line(c.bold('Usage'))
  line('  paysum <command> [options]')
  line()
  line(c.bold('Commands'))
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    helpRow(cmd.args ? `${name} ${cmd.args}` : name, cmd.summary)
  }
  line()
  line(c.bold('Options'))
  helpRow('--key <sk_...>', 'Use this key instead of PAYSUM_API_KEY or your saved key')
  helpRow('--api <url>', 'API origin (default https://paysum.io)')
  helpRow('--store <id>', 'Select the saved store to sign out of')
  helpRow('--out <file.zip>', 'Save the converted ZIP from theme-port')
  helpRow('-o, --open', 'Open the preview or storefront in your browser')
  helpRow('-f, --force', 'Overwrite conflicts or init into a non-empty folder')
  helpRow('-y, --yes', 'Publish without asking')
  helpRow('--no-push', 'Publish the drafts already on the server')
  helpRow('-h, --help', 'Show this help')
  helpRow('-v, --version', 'Show the CLI version')
  line()
  line(c.bold('Quick Start'))
  line(`  ${c.gray('$')} paysum login`)
  line(`  ${c.gray('$')} paysum init my-theme && cd my-theme`)
  line(`  ${c.gray('$')} paysum watch --open`)
  line()
}

function helpRow(label, summary) {
  line(`  ${c.cyan(label.padEnd(23))}${summary}`)
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
  if (!name || flags.help) {
    help()
    return name || flags.help ? 0 : 1
  }
  const command = COMMANDS[ALIASES[name] ?? name]
  if (!command) {
    fail(`Unknown command: ${name}`, 'Run `paysum --help` to see every command.')
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
