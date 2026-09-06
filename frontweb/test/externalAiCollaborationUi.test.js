import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('episode package API exposes external AI context, task creation and ZIP download', () => {
  const api = read('src/api/episodePackage.js')
  assert.match(api, /getExternalAiContext\(dramaId/)
  assert.match(api, /dramas\/\$\{dramaId\}\/external-ai\/context/)
  assert.match(api, /createExternalAiTask\(dramaId/)
  assert.match(api, /dramas\/\$\{dramaId\}\/external-ai\/tasks/)
  assert.match(api, /downloadExternalAiTask\(packageId\)/)
  assert.match(api, /external-ai\/tasks\/\$\{encodeURIComponent\(packageId\)\}\/download/)
  assert.match(api, /responseType: 'blob'/)
})

test('collaboration dialog follows context then task then result-import flow', () => {
  const dialog = read('src/components/ExternalAiCollaborationDialog.vue')
  assert.match(dialog, /新会话剧情上下文/)
  assert.match(dialog, /生成本集 AI 制作任务/)
  assert.match(dialog, /episodePackageAPI\.getExternalAiContext/)
  assert.match(dialog, /episodePackageAPI\.createExternalAiTask/)
  assert.match(dialog, /episodePackageAPI\.downloadExternalAiTask/)
  assert.match(dialog, /导入 AI 返回 JSON/)
  assert.match(dialog, /emit\('import-result'/)
  assert.match(dialog, /listBlankEpisodes/)
})

test('drama detail exposes collaboration entry and passes bound episode into result import', () => {
  const drama = read('src/views/DramaDetail.vue')
  assert.match(drama, /ExternalAiCollaborationDialog/)
  assert.match(drama, />外部 AI 协作</)
  assert.match(drama, /@import-result="openExternalAiResultImport"/)
  assert.match(drama, /:initial-target-episode-id="packageImportTargetEpisodeId"/)
})

test('package import dialog accepts an initial target episode from a generated task', () => {
  const dialog = read('src/components/EpisodePackageImportDialog.vue')
  assert.match(dialog, /initialTargetEpisodeId/)
  assert.match(dialog, /props\.initialTargetEpisodeId/)
  assert.match(dialog, /targetMode\.value = 'fill'/)
})
