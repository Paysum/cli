import readline from 'node:readline'

const interactive = process.stdout.isTTY && !process.env.CI
const color = interactive && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb'

const paint = (open, close) => (text) => (color ? `\x1b[${open}m${text}\x1b[${close}m` : String(text))

export const c = {
  bold: paint(1, 22),
  dim: paint(2, 22),
  red: paint(31, 39),
  green: paint(32, 39),
  yellow: paint(33, 39),
  blue: paint(34, 39),
  cyan: paint(36, 39),
  gray: paint(90, 39),
}

const strip = (text) => String(text).replace(/\x1b\[[0-9;]*m/g, '')
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - strip(text).length))

export const symbols = {
  ok: c.green('✓'),
  fail: c.red('✗'),
  warn: c.yellow('!'),
  up: c.cyan('↑'),
  down: c.blue('↓'),
  remove: c.red('−'),
  dot: c.gray('·'),
}

export function line(text = '') {
  process.stdout.write(`${text ? `  ${text}` : ''}\n`)
}

export function heading(title, detail) {
  line()
  line(`${c.bold(title)}${detail ? `  ${c.gray(detail)}` : ''}`)
  line()
}

export const success = (text) => line(`${symbols.ok} ${text}`)
export const warn = (text) => line(`${symbols.warn} ${text}`)
export const hint = (text) => line(c.gray(text))

export function fail(text, help) {
  process.stderr.write(`\n  ${symbols.fail} ${text}\n`)
  if (help) process.stderr.write(`  ${c.gray(help)}\n`)
  process.stderr.write('\n')
}

export function rows(entries) {
  const width = Math.max(...entries.map(([label]) => label.length)) + 2
  for (const [label, value] of entries) line(`${c.gray(pad(label, width))}${value}`)
}

export function table(data) {
  const widths = data[0].map((_, column) =>
    Math.max(...data.map((row) => strip(row[column]).length)),
  )
  data.forEach((row, index) => {
    const text = row.map((cell, column) => pad(String(cell), widths[column] + 3)).join('')
    line(index === 0 ? c.gray(text.trimEnd()) : text.trimEnd())
  })
}

export const time = () => c.gray(new Date().toTimeString().slice(0, 8))

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function spinner(text) {
  if (!interactive) {
    line(`${c.gray('…')} ${text}`)
    return { update() {}, stop() {} }
  }
  let frame = 0
  let label = text
  const render = () => process.stdout.write(`\r\x1b[2K  ${c.cyan(FRAMES[frame])} ${label}`)
  render()
  const timer = setInterval(() => {
    frame = (frame + 1) % FRAMES.length
    render()
  }, 80)
  return {
    update(next) {
      label = next
      render()
    },
    stop() {
      clearInterval(timer)
      process.stdout.write('\r\x1b[2K')
    },
  }
}

export function ask(question, { secret = false } = {}) {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error(`${question} needs an interactive terminal`))
  }
  if (secret) return askSecret(question)
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`  ${question} ${c.gray('›')} `, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function askSecret(question) {
  const { stdin, stdout } = process
  return new Promise((resolve) => {
    stdout.write(`  ${question} ${c.gray('›')} `)
    let value = ''
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
    }
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup()
          stdout.write('\n')
          resolve(value.trim())
          return
        }
        if (char === '\u0003') {
          cleanup()
          stdout.write('\n')
          process.exit(130)
        }
        if (char === '\u007f' || char === '\b') {
          if (value) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
        } else if (char >= ' ') {
          value += char
          stdout.write(c.gray('•'))
        }
      }
    }
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    stdin.on('data', onData)
  })
}

export async function confirm(question) {
  const answer = await ask(`${question} ${c.gray('(y/N)')}`)
  return /^y(es)?$/i.test(answer)
}

export const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY)
