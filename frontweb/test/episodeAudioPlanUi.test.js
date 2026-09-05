import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('episode audio panel exposes all BGM modes, ownership, AI planning, and unlock controls', async () => {
  const source = await readFile(new URL('../src/components/episode/AudioPlanPanel.vue', import.meta.url), 'utf8')
  for (const mode of ['none', 'episode_track', 'per_segment']) assert.match(source, new RegExp(`value="${mode}"`))
  for (const owner of ['h3_native', 'post_tts', 'none']) assert.match(source, new RegExp(`value="${owner}"`))
  assert.match(source, /AI 规划每段配乐/)
  assert.match(source, /恢复 AI 管理/)
  assert.match(source, /audio_description/)
  assert.match(source, /music_cue/)
  assert.match(source, /diegetic_music/)
  assert.match(source, /speech_override/)
})

test('episode audio API carries canonical plan plus explicit unlock fields', async () => {
  const source = await readFile(new URL('../src/api/episodeAudio.js', import.meta.url), 'utf8')
  assert.match(source, /audio_plan: audioPlan/)
  assert.match(source, /unlock_fields: unlockFields/)
  assert.match(source, /audio-plan\/plan/)
})
