import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dialogSource = fs.readFileSync(path.join(root, 'src/components/EpisodePackageImportDialog.vue'), 'utf8')
const apiSource = fs.readFileSync(path.join(root, 'src/api/episodePackage.js'), 'utf8')

test('fill mode picks the target episode from a blank-episode select instead of a raw id input', () => {
  // 手输集 ID 不可用:全站无任何地方展示集 ID → 必须是下拉选择
  assert.doesNotMatch(dialogSource, /el-input-number[\s\S]{0,400}targetEpisodeId/)
  assert.match(dialogSource, /el-select[\s\S]{0,600}v-model="targetEpisodeId"/)
  // 懒加载:进入 fill 模式时拉取空白剧集列表
  assert.match(dialogSource, /watch\(targetMode, \(mode\) => \{/)
  assert.match(dialogSource, /if \(mode === 'fill'\) loadBlankEpisodes\(\)/)
  // 选项展示“第N集·标题 (ID:x)”并由选中触发重新预览
  assert.match(dialogSource, /blankEpisodeLabel\(ep\)/)
  assert.match(dialogSource, /第\$\{ep\.episode_number\}集/)
  assert.match(dialogSource, /@change="onTargetChange"/)
})

test('episode package API exposes the blank-episodes endpoint', () => {
  assert.match(apiSource, /listBlankEpisodes\(dramaId\)/)
  assert.match(apiSource, /\/dramas\/\$\{dramaId\}\/blank-episodes/)
})
