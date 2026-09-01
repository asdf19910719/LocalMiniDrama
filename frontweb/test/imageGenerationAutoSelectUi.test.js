import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('store wires auto select state, completion toast and batch recovery', () => {
  const source = fs.readFileSync(path.join(root, 'src/stores/imageGenerationStore.js'), 'utf8')
  assert.match(source, /autoSelect/)
  assert.match(source, /getImageGenerationSettings\(/)
  assert.match(source, /updateImageGenerationSettings\(/)
  assert.match(source, /auto_select/)
  assert.match(source, /event\.type === 'completed'/)
  assert.match(source, /已生成并挂载/)
  assert.match(source, /batchSelectFirst/)
  const api = fs.readFileSync(path.join(root, 'src/api/imageGenerationTasks.js'), 'utf8')
  assert.match(api, /batch-select-first/)
})

test('pill and drawer expose batch recovery and the auto select toggle', () => {
  const pill = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerationTaskPill.vue'), 'utf8')
  assert.match(pill, /全部采用首选/)
  assert.match(pill, /batchSelectFirst/)
  const drawer = fs.readFileSync(path.join(root, 'src/components/imageGeneration/ImageGenerationDrawer.vue'), 'utf8')
  assert.match(drawer, /自动采用首个候选/)
})
