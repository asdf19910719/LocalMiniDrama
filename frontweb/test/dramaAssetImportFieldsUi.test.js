import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'src/views/DramaDetail.vue'), 'utf8')

test('制作角色编辑不把缺失 role 默认成 minor，并展示外部字段', () => {
  assert.match(source, /role: item\.role \?\? ''/)
  for (const field of ['personality', 'appearance', 'voice_style', 'polished_prompt', 'negative_prompt']) {
    assert.match(source, new RegExp(`editDramaCharForm\\.${field}`))
  }
})

test('制作场景编辑将说明与提示词分离并展示完整字段', () => {
  for (const field of ['state', 'description', 'atmosphere', 'prompt', 'negative_prompt']) {
    assert.match(source, new RegExp(`editDramaSceneForm\\.${field}`))
  }
  assert.match(source, /description: editDramaSceneForm\.value\.description/)
  assert.match(source, /prompt: editDramaSceneForm\.value\.prompt/)
})
