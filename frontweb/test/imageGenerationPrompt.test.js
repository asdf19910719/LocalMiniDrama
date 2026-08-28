import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveImageGenerationPrompt } from '../src/utils/imageGenerationPrompt.js'

test('character image generation uses visual appearance instead of story background', () => {
  assert.equal(resolveImageGenerationPrompt('character', {
    name: '林默',
    appearance: '黑发少年，青色道袍',
    description: '青云宗外门弟子，为续命前往荒兽渊',
  }), '黑发少年，青色道袍')
})

test('an explicit frame prompt remains authoritative', () => {
  assert.equal(resolveImageGenerationPrompt('storyboard_first', {
    image_prompt: '普通分镜描述',
  }, '专业首帧提示'), '专业首帧提示')
})
