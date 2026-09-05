import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('light theme cards avoid backdrop filters that repaint during document scrolling', () => {
  const film = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  const lightCardRule = film.match(/html\.light \.card\s*\{([^}]*)\}/)?.[1]

  assert.ok(lightCardRule, 'the light theme card rule should exist')
  assert.doesNotMatch(lightCardRule, /(?:-webkit-)?backdrop-filter\s*:/)
})
