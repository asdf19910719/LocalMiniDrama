import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetImageUrl } from '../src/utils/mediaUrl.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('extra image strip thumbs resolve absolute history paths via the shared media url', () => {
  const film = fs.readFileSync(path.join(root, 'src/views/FilmCreate.vue'), 'utf8')
  const body = film.match(/function localPathToUrl\(p\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(body, 'localPathToUrl should exist')
  // 绝对历史路径必须交给共享媒体 URL 工具(外部抓取结果走鉴权内容接口)
  assert.match(body, /resolveAssetImageUrl\(p\)/)
  assert.doesNotMatch(body, /'\/static\/' \+/)
})

test('string absolute history paths map to the external content endpoint', () => {
  const resultId = 'fcea2a76-f5b0-41df-8aa6-fdc57cc4e061'
  const url = assetImageUrl(`E:\\project\\LocalMiniDrama\\backend-node\\data\\external-web\\3\\unassigned\\${resultId}\\original.png`)
  assert.equal(url, `/api/v1/external-generation/results/${resultId}/content`)
})
