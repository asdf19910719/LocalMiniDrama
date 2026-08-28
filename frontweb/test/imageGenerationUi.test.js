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
  const setting = read('src/components/imageGeneration/ImageGenerationChannelSetting.vue')
  const store = read('src/stores/imageGenerationStore.js')

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
  assert.match(setting, /setDefault/)
  assert.match(setting, /默认生图方式/)
  assert.match(drawer, /恢复结果捕获/)
  assert.match(drawer, /task\.error_message/)
  assert.match(store, /loadSummary\(input\.dramaId,\s*\{\s*reattach:\s*false\s*\}\)/)
  assert.match(store, /loadSummary\(prepared\.task\.drama_id,\s*\{\s*reattach:\s*false\s*\}\)/)
  assert.match(store, /loadSummary\(currentTask\.value\.drama_id,\s*\{\s*reattach:\s*false\s*\}\)/)
  assert.match(store, /buildChatGPTImageGenerationPrompt/)
  assert.match(store, /resolveChatGPTPrepareAction/)
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
  assert.match(film, /ImageGenerationChannelSetting/)
  assert.match(detail, /ImageGenerationChannelSetting/)
  assert.match(detail, /loadDefault\(dramaId\)/)
  assert.match(film, /catch \(error\)/)
  assert.match(film, /selectImageGenerationResult\(result\)[\s\S]*loadDrama\(\)/)
  assert.match(canvas, /@select="onImageGenerationSelect"/)
  assert.match(canvas, /selectImageGenerationResult\(result\)[\s\S]*refreshCanvas\(true\)/)
  assert.match(detail, /@select="onImageGenerationSelect"/)
  assert.match(detail, /imageGeneration\.selectResult\(result\)[\s\S]*loadDrama\(\)/)
})

test('drawer owns queue states: queued alert, no manual send, failed requeue', () => {
  const drawer = read('src/components/imageGeneration/ImageGenerationDrawer.vue')

  assert.match(drawer, /task\.status === 'queued'/)
  assert.match(drawer, /已加入队列/)
  assert.match(drawer, /重新排队/)
  assert.match(drawer, /自动加入队列依次发送/)
  assert.doesNotMatch(drawer, /立即自动发送/)
  assert.doesNotMatch(drawer, /task\.status === 'preparing' && task\.error_message/)
})

test('unified entry only creates the queued task and views requeue failed ones', () => {
  const film = read('src/views/FilmCreate.vue')
  const canvas = read('src/views/DramaCanvas.vue')
  const detail = read('src/views/DramaDetail.vue')

  assert.doesNotMatch(film, /const task = await openImageGenerationTask\([\s\S]{0,400}sendImageGenerationToChatGPT\(task\)/)
  assert.match(film, /onImageGenerationRequeue/)
  // Measured gaps (chars after the open-call paren to the next send call):
  // a direct send sits at 280 (canvas) / 182 (detail); enqueue-only entries
  // leave the drawer's onImageGenerationSend as the next send at 437 / 338,
  // hence thresholds 400 and 250.
  assert.doesNotMatch(canvas, /const task = await openImageGenerationTask\([\s\S]{0,400}(?:sendImageGenerationToChatGPT|sendToChatGPT)\(task\)/)
  assert.doesNotMatch(detail, /await imageGeneration\.open\([\s\S]{0,250}imageGeneration\.sendToChatGPT\(task\)/)
})

test('failed requeue shows a spinner: store requeueTask drives the shared loading flag', () => {
  const store = read('src/stores/imageGenerationStore.js')

  assert.match(store, /async function requeueTask\(task\) \{[\s\S]{0,160}loading\.value = true/)
  assert.match(store, /async function requeueTask\(task\) \{[\s\S]{0,700}finally \{\s*loading\.value = false\s*\}/)
})
