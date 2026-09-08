import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assetGenerationModeOptions,
  defaultAssetGenerationMode,
  normalizeAssetGenerationMode,
} from '../src/constants/assetGenerationModes.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('exposes only the generation modes supported by each current asset type', () => {
  assert.deepEqual(assetGenerationModeOptions('character').map((item) => item.value), ['SINGLE', 'TURNAROUND'])
  assert.deepEqual(assetGenerationModeOptions('character_variant').map((item) => item.value), ['SINGLE', 'TURNAROUND'])
  assert.deepEqual(assetGenerationModeOptions('scene').map((item) => item.value), ['NORMAL', 'QUAD_GRID'])
  assert.equal(defaultAssetGenerationMode('character'), 'TURNAROUND')
  assert.equal(defaultAssetGenerationMode('character_variant'), 'SINGLE')
  assert.equal(defaultAssetGenerationMode('scene'), 'NORMAL')
})

test('normalizes stored modes and falls back safely for missing or invalid values', () => {
  assert.equal(normalizeAssetGenerationMode('character', 'single'), 'SINGLE')
  assert.equal(normalizeAssetGenerationMode('scene', 'quad_grid'), 'QUAD_GRID')
  assert.equal(normalizeAssetGenerationMode('scene', 'PANORAMA'), 'NORMAL')
})

test('project cards and variant studio expose per-asset mode controls without a global scene toggle', () => {
  const film = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  const detail = fs.readFileSync(path.join(root, 'src/views/DramaDetail.vue'), 'utf8')
  const studio = fs.readFileSync(path.join(root, 'src/components/CharacterVariantStudio.vue'), 'utf8')
  assert.match(film, /AssetGenerationModeSelect/)
  assert.match(film, /saveCharacterAssetMode/)
  assert.match(film, /saveSceneAssetMode/)
  assert.match(detail, /saveDramaAssetMode/)
  assert.match(detail, /openCharacterStates/)
  assert.match(detail, /人物状态/)
  assert.match(film, /route\.query\.asset === 'states'/)
  assert.doesNotMatch(film, /sceneUseQuadGrid/)
  assert.match(studio, /use_identity_reference/)
  assert.match(studio, /update-identity-reference/)
  assert.match(studio, /update-mode/)
})

test('FilmCreate keeps the per-asset mode readable inside the narrow media action column', () => {
  const film = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  assert.match(film, /\.asset-cover-actions\s*\{[^}]*flex-wrap:\s*wrap/s)
  assert.match(film, /\.asset-cover-actions\s+:deep\(\.asset-generation-mode-select\)\s*\{[^}]*flex:\s*0\s+0\s+100%/s)
})
