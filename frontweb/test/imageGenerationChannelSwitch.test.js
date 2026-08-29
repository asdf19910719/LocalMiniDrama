import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const views = ['FilmCreate', 'DramaCanvas', 'DramaDetail'].map((name) => ({
  name, source: fs.readFileSync(path.join(root, 'src/views', `${name}.vue`), 'utf8'),
}))

test('split button dropdown switches the default channel without generating', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerateSplitButton.vue'), 'utf8')
  assert.match(source, /@command="selectChannel"/)
  assert.doesNotMatch(source, /@command="generate"/)
  assert.match(source, /emit\('select-channel', channel\)/)
  assert.match(source, /@click="generate\(defaultChannel\)"/)
})

test('views persist the selected default channel', () => {
  for (const { name, source } of views) {
    assert.match(source, /@select-channel="onSelectImageChannel"/, `${name} 缺少 select-channel 接线`)
    assert.match(source, /async function onSelectImageChannel\(channel\)/, `${name} 缺少处理函数`)
    assert.match(source, /setImageGenerationDefaultChannel\(channel\)/, `${name} 未持久化默认通道`)
  }
})

test('store exposes setDefaultChannel through the api', () => {
  const store = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  assert.match(store, /async function setDefaultChannel\(channel\)/)
  assert.match(store, /imageGenerationTaskAPI\.setDefault\(dramaId\.value, channel\)/)
  const api = fs.readFileSync(path.join(root, 'src/api/imageGenerationTasks.js'), 'utf8')
  assert.match(api, /setDefault\(dramaId, channel\)/)
})

test('project pages mount the image task pill for drawer re-entry', () => {
  const pill = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerationTaskPill.vue'), 'utf8')
  assert.match(pill, /loadSummary\(props\.dramaId, \{ reattach: false \}\)/)
  assert.match(pill, /store\.openTaskById\(id\)/)
  assert.match(pill, /setInterval\(refresh, 5000\)/)
  for (const { name, source } of views) {
    assert.match(source, /ImageGenerationTaskPill :drama-id="dramaId"/, `${name} 未挂载生图任务胶囊`)
    assert.match(source, /import ImageGenerationTaskPill/, `${name} 未导入生图任务胶囊`)
  }
})
