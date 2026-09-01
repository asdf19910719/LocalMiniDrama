import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('image updated at component renders formatted time and hides when empty', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/ImageUpdatedAt.vue'), 'utf8')
  assert.match(source, /defineProps/)
  assert.match(source, /padStart/)
  assert.match(source, /v-if/)
  assert.match(source, /图更新于/)
})

test('film create cards render the image updated time', () => {
  const film = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  assert.match(film, /ImageUpdatedAt/)
  assert.match(film, /image_updated_at/)
})
