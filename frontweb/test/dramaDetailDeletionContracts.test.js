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

test('剧集详情页为每类制作资源提供确认删除并刷新详情的操作', () => {
  const view = read('src/views/DramaDetail.vue')
  const cases = [
    ['角色', 'deleteDramaChar', 'characterAPI'],
    ['场景', 'deleteDramaScene', 'sceneAPI'],
    ['道具', 'deleteDramaProp', 'propAPI'],
  ]

  for (const [label, handlerName, apiName] of cases) {
    assert.match(view, new RegExp(`删除制作${label}`))
    assert.match(view, new RegExp(`@click="${handlerName}\\(item\\)"`))
    const start = view.indexOf(`async function ${handlerName}`)
    const end = view.indexOf('\nasync function ', start + 1)
    const handler = view.slice(start, end === -1 ? undefined : end)
    assert.match(handler, /ElMessageBox\.confirm/)
    assert.match(handler, new RegExp(`await ${apiName}\\.delete\\(item\\.id\\)`))
    assert.match(handler, /await loadDrama\(\)/)
  }
})
