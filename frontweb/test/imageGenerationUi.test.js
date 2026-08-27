import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('shared image generation controls expose concise channel copy and one summary API', () => {
  const api = read('src/api/imageGenerationTasks.js')
  const button = read('src/components/imageGeneration/ImageGenerateSplitButton.vue')
  const drawer = read('src/components/imageGeneration/ImageGenerationDrawer.vue')
  const queue = read('src/components/imageGeneration/ImageGenerationQueue.vue')
  const composable = read('src/composables/useImageGeneration.js')
  const bridge = read('src/utils/imageGenerationBridge.js')

  assert.match(api, /image-generation-summary/)
  assert.match(api, /image-generation-batches/)
  assert.match(button, /ChatGPT 生成/)
  assert.match(button, /默认模型生成/)
  assert.match(drawer, /发送到 ChatGPT/)
  assert.match(drawer, /设为当前图片/)
  assert.doesNotMatch(drawer, /External Web Image|Prepare Job|Job.*hash/i)
  assert.match(queue, /暂停/)
  assert.match(queue, /跳过当前/)
  assert.match(composable, /loadSummary/)
  assert.match(api, /prepare-send/)
  assert.match(api, /acknowledge/)
  assert.match(bridge, /aistory-external-generation-response/)
  assert.doesNotMatch(bridge, /return \{ ok: true \}/)
})

test('all project asset and storyboard entry points use the unified controls', () => {
  const film = read('src/views/FilmCreate.vue')
  const canvas = read('src/views/DramaCanvas.vue')
  const detail = read('src/views/DramaDetail.vue')
  const assetPanel = read('src/components/dramaCanvas/CanvasAssetPanel.vue')

  for (const target of ['character', 'scene', 'prop', 'storyboard_main', 'storyboard_first', 'storyboard_last']) {
    assert.match(film + canvas + detail + assetPanel, new RegExp(target))
  }
  assert.match(film, /ImageGenerateSplitButton/)
  assert.match(canvas, /ImageGenerateSplitButton|CanvasAssetPanel/)
  assert.match(detail, /ImageGenerateSplitButton/)
  assert.match(assetPanel, /ImageGenerateSplitButton/)
  assert.doesNotMatch(film, /ExternalWebGenerationPanel|film-create-external-generation/)
})
