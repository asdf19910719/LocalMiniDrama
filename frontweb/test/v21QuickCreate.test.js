import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('B6 自由创作加入个人资产库：接 character/scene/prop-library create，原生弹窗清除', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /addToLibrary/, 'api 应有 addToLibrary')
  assert.match(api, /\$\{kind\}-library/, '复用 v1 资产库 create 端点')
  const view = read('src/views/productionStudio/QuickCreateView.vue')
  assert.match(view, /addToLibrary/, '入库按钮真实调用')
  assert.match(view, /libraryKind/, '可选择角色/场景/道具库')
  assert.match(view, /source_type: 'quick-create'/, '入库来源可追溯')
  assert.match(view, /abandonOpen/, '放弃确认走专用 Modal')
  assert.doesNotMatch(view, /comingSoon|window\.confirm|window\.prompt|alert\(/, '本视图占位与原生弹窗清除')
})
