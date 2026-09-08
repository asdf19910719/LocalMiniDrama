import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('风格选择器从后端目录加载并提供四列分类、搜索、详情与真实提示词说明', () => {
  const source = read('src/components/StylePickerButton.vue')
  assert.match(source, /stylesAPI\.list\(\)/)
  assert.match(source, /grid-template-columns:\s*repeat\(4/)
  for (const label of ['全部', '真人', '3D', '2D', '我的']) assert.match(source, new RegExp(label))
  assert.match(source, /查看实际中文风格提示词/)
  assert.match(source, /查看实际英文风格提示词/)
  assert.match(source, /stylesAPI\.create/)
})

test('项目创建、详情、制作与自由创作只提交 style_id', () => {
  const files = [
    'src/views/FilmList.vue',
    'src/views/DramaDetail.vue',
    'src/views/FilmCreate.vue',
    'src/views/FreeCreate.vue',
    'src/composables/useStoryGeneration.js',
  ]
  const source = files.map(read).join('\n')
  assert.match(source, /style_id:/)
  assert.doesNotMatch(source, /style_prompt_zh|style_prompt_en/)
  assert.match(read('src/views/FreeCreate.vue'), /<StylePickerButton v-model="styleId"/)
})
