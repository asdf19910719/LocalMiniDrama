import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

test('C1 专用容器：C1 点名视图不再出现 window.prompt/alert/confirm', () => {
  for (const p of [
    'src/views/productionStudio/ProjectEpisodesView.vue',
    'src/views/productionStudio/studio/StoryboardStage.vue',
    'src/views/productionStudio/QuickCreateView.vue',
  ]) {
    const view = read(p)
    assert.doesNotMatch(view, /window\.prompt|window\.confirm|window\.alert/, `${p} 不得使用原生弹窗`)
    assert.doesNotMatch(view, /\balert\(/, `${p} 不得使用 alert`)
  }
  const ep = read('src/views/productionStudio/ProjectEpisodesView.vue')
  assert.match(ep, /rowMenuId/, '剧集行操作走行内菜单')
  assert.match(ep, /confirmNewEpisode/, '新建集号走 Modal')
  assert.match(ep, /confirmRename/, '重命名走 Modal')
  assert.match(ep, /confirmReorder/, '调整集序走 Modal')
  const sb = read('src/views/productionStudio/studio/StoryboardStage.vue')
  assert.match(sb, /openImageUrl/, '分镜上传图片 URL 走 Modal')
  assert.match(sb, /this\.notice = /, '错误提示走 notice 条')
})
