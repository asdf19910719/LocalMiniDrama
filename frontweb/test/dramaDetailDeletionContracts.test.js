import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('剧集详情页使用单集删除接口而不是重写整个分集列表', () => {
  const api = read('src/api/drama.js')
  const view = read('src/views/DramaDetail.vue')
  const deleteHandler = view.slice(
    view.indexOf('async function onDeleteEpisode'),
    view.indexOf('async function onAddEpisode'),
  )

  assert.match(api, /deleteEpisode\(id\)\s*\{\s*return request\.delete\(`\/episodes\/\$\{id\}`\)/)
  assert.match(deleteHandler, /await dramaAPI\.deleteEpisode\(ep\.id\)/)
  assert.doesNotMatch(deleteHandler, /saveEpisodes/)
})
