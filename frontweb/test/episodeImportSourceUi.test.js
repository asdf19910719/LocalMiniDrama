import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('项目页与制作页复用同一来源弹窗，且项目卡片操作不触发跳转', () => {
  const drama = read('src/views/DramaDetail.vue')
  const film = read('src/views/FilmCreate.vue')
  assert.match(drama, /EpisodeImportSourceDialog/)
  assert.match(drama, /@click\.stop="openImportSource\(ep\)"/)
  assert.match(film, /EpisodeImportSourceDialog/)
  assert.match(film, /currentEpisode\?\.import_source/)
})

test('来源弹窗懒加载并以纯文本展示三个页签', () => {
  const dialog = read('src/components/EpisodeImportSourceDialog.vue')
  const api = read('src/api/episodePackage.js')
  assert.match(api, /episodes\/\$\{encodeURIComponent\(episodeId\)\}\/import-source/)
  assert.match(dialog, /episodePackageAPI\.getImportSource/)
  assert.match(dialog, /name="raw"/)
  assert.match(dialog, /name="normalized"/)
  assert.match(dialog, /name="report"/)
  assert.doesNotMatch(dialog, /v-html/)
})
