import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('storyboard-bound callers use the prepared video endpoint', async () => {
  const files = [
    '../src/views/FilmCreate.vue',
    '../src/composables/useCanvasWorkflowRunner.js',
    '../src/composables/useCanvasEpisodeGenerate.js',
    '../src/composables/useVideoGenerationPanel.js',
  ]
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))
  assert.equal(sources.some((source) => /videosAPI\.create\(/.test(source)), false)
  assert.equal(sources.some((source) => /prepareAndCreate/.test(source)), true)
})

test('FreeCreate keeps strict non-project submission and rejects storyboard-bound H3 capability', async () => {
  const source = await readFile(new URL('../src/views/FreeCreate.vue', import.meta.url), 'utf8')
  assert.match(source, /requiresStoryboardH3Draft/)
  assert.match(source, /H3_STORYBOARD_REQUIRED/)
  assert.match(source, /videosAPI\.create\(body\)/)
})
