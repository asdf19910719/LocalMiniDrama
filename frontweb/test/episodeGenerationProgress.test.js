import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('episode progress API and polling composable expose the current episode contract', () => {
  const api = read('src/api/episodeGenerationProgress.js')
  const composable = read('src/composables/useEpisodeGenerationProgress.js')
  assert.match(api, /generation-progress/)
  assert.match(api, /encodeURIComponent\(episodeId\)/)
  assert.match(composable, /setTimeout/)
  assert.match(composable, /onBeforeUnmount/)
  assert.match(composable, /watch\(\(\) => resolveValue\(episodeIdSource\)/)
})

test('FilmCreate mounts episode progress below the one-click pipeline and keeps environment independent', () => {
  const film = read('src/views/FilmCreate.vue')
  const panel = read('src/components/EpisodeGenerationProgress.vue')
  assert.match(film, /EpisodeGenerationProgress/)
  assert.match(film, /:episode-id="currentEpisodeId"/)
  assert.match(film, /:environment="imageGenerationEnvironment"/)
  assert.match(film, /onEpisodeProgressOpenVideo/)
  assert.match(panel, /ImageGenerationEnvironmentStatus/)
  assert.match(panel, /progress\.image\?\.by_type/)
  assert.match(panel, /progress\.video\?\.active_items/)
  assert.match(panel, /整集合成/)
})
