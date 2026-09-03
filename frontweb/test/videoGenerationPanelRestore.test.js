import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { candidateDuration, restoreLastUsedPrompt } from '../src/composables/useVideoGenerationPanel.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('restores the last used prompt from the newest candidate group', () => {
  const groups = [
    { id: 'g-new', candidates: [{ id: 'c1', video_generation: { prompt_snapshot: '最新的统一通道提示词' } }] },
    { id: 'g-old', candidates: [{ id: 'c0', job_input_json: JSON.stringify({ prompt: '旧的 H3 提示词' }) }] },
  ]
  assert.equal(restoreLastUsedPrompt(groups), '最新的统一通道提示词')
  assert.equal(restoreLastUsedPrompt([groups[1]]), '旧的 H3 提示词')
  assert.equal(restoreLastUsedPrompt([]), '')
  assert.equal(restoreLastUsedPrompt([{ id: 'g', candidates: [{ id: 'c' }] }]), '')
})

test('computes generation duration from job or video timestamps', () => {
  assert.equal(candidateDuration({ job_started_at: '2026-08-29T00:00:00.000Z', job_completed_at: '2026-08-29T00:03:12.000Z' }), '3 分 12 秒')
  assert.equal(candidateDuration({ video_generation: { created_at: '2026-08-29T01:00:00.000Z', completed_at: '2026-08-29T01:00:45.000Z' } }), '45 秒')
  assert.equal(candidateDuration({ job_started_at: '2026-08-29T00:00:00.000Z' }), '')
  assert.equal(candidateDuration({}), '')
  assert.equal(candidateDuration({ job_started_at: 'bad', job_completed_at: 'also bad' }), '')
})

test('panel restores prompt and shows duration in the candidate card', () => {
  const panel = fs.readFileSync(path.join(root, 'src/components/video/VideoGenerationPanel.vue'), 'utf8')
  assert.match(panel, /生成耗时/)
  assert.match(panel, /candidateDuration/)
  assert.match(panel, /已恢复上次生成使用的提示词/)
  assert.match(panel, /promptRestored,/)
  assert.match(panel, /candidateDuration,/)
  const composable = fs.readFileSync(path.join(root, 'src/composables/useVideoGenerationPanel.js'), 'utf8')
  assert.match(composable, /promptRestored/)
  assert.match(composable, /restoreLastUsedPrompt\(groups\.value\)/)
})

test('optional voice reference flows into the H3 candidate request', () => {
  const composable = fs.readFileSync(path.join(root, 'src/composables/useVideoGenerationPanel.js'), 'utf8')
  assert.match(composable, /useVoiceReference: false/)
  assert.match(composable, /if \(form\.useVoiceReference\) structured\.useVoiceReference = true/)
  const panel = fs.readFileSync(path.join(root, 'src/components/video/VideoGenerationPanel.vue'), 'utf8')
  assert.match(panel, /角色音色参考/)
  assert.match(panel, /v-model="form\.useVoiceReference"/)
})

test('H3 configs lock the duration input because the draft decides the duration', () => {
  const panel = fs.readFileSync(path.join(root, 'src/components/video/VideoGenerationPanel.vue'), 'utf8')
  assert.match(panel, /:disabled="isH3Config"/)
  assert.match(panel, /由 H3 草稿决定/)
  assert.match(panel, /v-model="form\.duration"/)
})
