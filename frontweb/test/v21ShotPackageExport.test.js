import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('C4 Shot Package 导出走 schema 化端点，替换原始列表导出', () => {
  const api = read('src/v21/api.js')
  assert.match(api, /getShotPackage/, 'api 应有 getShotPackage')
  const view = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.match(view, /v21\.getShotPackage\(this\.episodeId\)/, '导出调用 schema 化端点')
  assert.match(view, /shot-package-v2\.1|Shot Package/, '导出语义保留')
  const backend = read('../backend-node/src/v21/routes.js')
  assert.match(backend, /shot-package/, '后端注册 shot-package 端点')
  const svc = read('../backend-node/src/v21/storyboard/shotPackageService.js')
  assert.match(svc, /local-mini-drama\.shot-package/, 'schema 常量正确')
  assert.match(svc, /character_state_version_ids/, '引用组装含角色状态')
  assert.match(svc, /music_intent/, '音频组装含音乐意图')
})
