import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExternalGenerationShotContext } from '../src/utils/externalGenerationShot.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('FilmCreate renders external generation panel for every storyboard row', () => {
  const source = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  assert.match(source, /ExternalWebGenerationPanel/)
  assert.match(source, /:storyboard-id="sb\.id"/)
  assert.match(source, /v-for="\(sb, i\) in storyboards"/)
})

test('shot context keeps identity and deterministic reference order', () => {
  const context = buildExternalGenerationShotContext({
    dramaId: 7,
    storyboard: { id: 42, image_prompt: 'shot prompt', description: 'fallback' },
    getScene: () => ({ id: 3, location: 'street', image_url: '/scene.png' }),
    getCharacters: () => [{ id: 8, name: 'A', image_url: '/a.png' }],
    getProps: () => [{ id: 9, name: 'Key', image_url: '/key.png' }],
    assetImageUrl: (item) => item.image_url,
  })
  assert.deepEqual(context, {
    dramaId: 7,
    storyboardId: 42,
    prompt: 'shot prompt',
    references: [
      { name: 'scene-3', mime: 'image/png', url: '/scene.png', role: 'scene', sourceId: 3 },
      { name: 'character-8', mime: 'image/png', url: '/a.png', role: 'character', sourceId: 8 },
      { name: 'prop-9', mime: 'image/png', url: '/key.png', role: 'prop', sourceId: 9 },
    ],
  })
})
