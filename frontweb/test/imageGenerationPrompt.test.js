import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildChatGPTImageGenerationPrompt,
  resolveImageGenerationPrompt,
} from '../src/utils/imageGenerationPrompt.js'

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

test('ChatGPT execution prompt isolates every image task from conversation history', () => {
  const prompt = buildChatGPTImageGenerationPrompt('白发剑客，角色设定图', 'character')

  assert.match(prompt, /全新的、彼此独立的图片生成任务/)
  assert.match(prompt, /忽略本会话此前所有人物、场景、道具、图片和提示词/)
  assert.match(prompt, /只依据本条消息生成/)
  assert.match(prompt, /角色设定图/)
  assert.match(prompt, /白发剑客，角色设定图/)
})

test('character variant prompt treats the attached base image as identity only when a reference is present', () => {
  const prompt = buildChatGPTImageGenerationPrompt('湿发，白衬衫，酒店夜间状态', 'character_variant', {
    hasIdentityReference: true,
  })

  assert.match(prompt, /基础人物身份参考图/)
  assert.match(prompt, /保留同一人物的脸部、年龄和体型/)
  assert.match(prompt, /不要照搬参考图的服装、发型状态、姿势和版式/)
  assert.match(prompt, /必须按照状态提示词改变造型/)
})

test('character variant prompt does not claim an identity reference when none is attached', () => {
  const prompt = buildChatGPTImageGenerationPrompt('湿发，白衬衫，酒店夜间状态', 'character_variant')

  assert.doesNotMatch(prompt, /基础人物身份参考图/)
  assert.match(prompt, /湿发，白衬衫/)
})

test('ChatGPT execution prompt includes the audited negative prompt snapshot', () => {
  const prompt = buildChatGPTImageGenerationPrompt('电影感雨夜街道', 'scene', {
    negativePrompt: '文字、水印、重复人物',
  })

  assert.match(prompt, /【必须避免】/)
  assert.match(prompt, /文字、水印、重复人物/)
})

test('ChatGPT execution prompt does not invent content for an empty business prompt', () => {
  assert.equal(buildChatGPTImageGenerationPrompt('  ', 'prop'), '')
})
