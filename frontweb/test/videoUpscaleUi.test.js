import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('episode finalization exposes optional Flash and Seed cloud upscale', () => {
  const film = read('src/views/FilmCreate.vue')
  assert.match(film, /v-model="videoUpscale"/)
  assert.match(film, /v-model="videoUpscaleMethod"/)
  assert.match(film, /FlashVSR（推荐/)
  assert.match(film, /SeedVR2/)
  assert.match(film, /1312×736 → 2624×1472/)
  assert.match(film, /upscale:\s*\{[\s\S]*enabled:\s*!!videoUpscale\.value[\s\S]*method:\s*videoUpscaleMethod\.value/)
});

test('upscale API and progress panel expose retry skip and cancel controls', () => {
  const api = read('src/api/videoUpscale.js')
  const panel = read('src/components/EpisodeGenerationProgress.vue')
  assert.match(api, /video-upscale\/capabilities/)
  assert.match(api, /video-upscale\/jobs\/\$\{encodeURIComponent\(id\)\}\/retry/)
  assert.match(api, /\/skip/)
  assert.match(api, /\/cancel/)
  assert.match(panel, /progress\.merge\.upscale/)
  assert.match(panel, /重试超分/)
  assert.match(panel, /跳过超分并继续/)
  assert.match(panel, /videoUpscaleAPI/)
});
