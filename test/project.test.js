import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  isThemePath,
  planPull,
  planPush,
  readLocalFile,
  scanLocal,
  sha256,
  writeLocalFile,
} from '../src/project.js'

const local = (entries) =>
  Object.fromEntries(Object.entries(entries).map(([file, content]) => [file, { content, hash: sha256(content) }]))

test('theme paths follow the server rules', () => {
  assert.equal(isThemePath('src/StorePage.tsx'), true)
  assert.equal(isThemePath('package.json'), true)
  assert.equal(isThemePath('paysum.json'), false)
  assert.equal(isThemePath('src/data/store.json'), false)
  assert.equal(isThemePath('node_modules/react/index.js'), false)
  assert.equal(isThemePath('src/.secret.ts'), false)
  assert.equal(isThemePath('sections/hero.liquid'), true)
  assert.equal(isThemePath('assets/fonts/Geist.woff2'), true)
  assert.equal(isThemePath('src/logo.png'), true)
  assert.equal(isThemePath('notes.docx'), false)
  assert.equal(isThemePath('src/has space.tsx'), false)
})

test('push sends edits and deletions since the last sync', () => {
  const files = local({ 'a.tsx': 'new', 'b.tsx': 'same', 'c.tsx': 'added' })
  const state = { 'a.tsx': sha256('old'), 'b.tsx': sha256('same'), 'gone.tsx': sha256('x') }
  assert.deepEqual(planPush(files, state), {
    upload: ['a.tsx', 'c.tsx'],
    remove: ['gone.tsx'],
    conflicts: [],
  })
})

test('push refuses to overwrite a file someone changed on the server', () => {
  const files = local({ 'a.tsx': 'mine' })
  const state = { 'a.tsx': sha256('base') }
  const remote = { 'a.tsx': sha256('theirs') }
  assert.deepEqual(planPush(files, state, remote).conflicts, ['a.tsx'])
  assert.deepEqual(planPush(files, state, { 'a.tsx': sha256('mine') }).upload, ['a.tsx'])
})

test('pull keeps local edits unless forced', () => {
  const files = local({ 'a.tsx': 'mine', 'b.tsx': 'base' })
  const state = { 'a.tsx': sha256('base'), 'b.tsx': sha256('base') }
  const remote = { 'a.tsx': sha256('theirs'), 'b.tsx': sha256('theirs') }
  assert.deepEqual(planPull(files, state, remote), {
    write: ['b.tsx'],
    remove: [],
    conflicts: ['a.tsx'],
  })
  assert.deepEqual(planPull(files, state, remote, { force: true }).write, ['a.tsx', 'b.tsx'])
})

test('pull removes files deleted on the server only when untouched locally', () => {
  const files = local({ 'old.tsx': 'base', 'edited.tsx': 'mine' })
  const state = { 'old.tsx': sha256('base'), 'edited.tsx': sha256('base') }
  const plan = planPull(files, state, {})
  assert.deepEqual(plan.remove, ['old.tsx'])
  assert.deepEqual(plan.conflicts, ['edited.tsx'])
})

test('scan skips dependencies, dotfiles and the project file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paysum-cli-'))
  const write = (file, content = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  write('src/App.tsx')
  write('src/styles.css')
  write('node_modules/x/index.js')
  write('.paysum/state.json')
  write('paysum.json')
  write('src/notes.docx')
  const { files } = scanLocal(root)
  assert.deepEqual(Object.keys(files).sort(), ['src/App.tsx', 'src/styles.css'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('binary assets round-trip in the server base64 form', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paysum-cli-'))
  const bytes = Buffer.from([0, 1, 2, 250, 255])
  const stored = `data:application/octet-stream;base64,${bytes.toString('base64')}`
  writeLocalFile(root, 'assets/fonts/a.woff2', stored)
  assert.deepEqual(fs.readFileSync(path.join(root, 'assets/fonts/a.woff2')), bytes)
  assert.deepEqual(readLocalFile(root, 'assets/fonts/a.woff2'), {
    content: stored,
    hash: sha256(stored),
  })
  assert.equal(scanLocal(root).files['assets/fonts/a.woff2'].hash, sha256(stored))
  fs.rmSync(root, { recursive: true, force: true })
})
