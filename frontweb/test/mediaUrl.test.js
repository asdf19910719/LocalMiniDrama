import test from 'node:test'
import assert from 'node:assert/strict'
import { assetImageUrl } from '../src/utils/mediaUrl.js'

test('maps imported external-generation Windows paths to the local content endpoint', () => {
  const resultId = 'ab4ab05f-6a6f-4c51-8aa7-963707be907c'
  const url = assetImageUrl({
    image_url: 'https://chatgpt.com/backend-api/estuary/content?id=expired',
    local_path: `E:\\AI\\references\\LocalMiniDrama\\backend-node\\data\\external-web\\3\\unassigned\\${resultId}\\original.png`,
  })

  assert.equal(url, `/api/v1/external-generation/results/${resultId}/content`)
})

test('keeps storage-relative paths on the static mount', () => {
  assert.equal(assetImageUrl({ local_path: 'projects/demo/images/image.png' }), '/static/projects/demo/images/image.png')
})

test('preserves already addressable application URLs', () => {
  assert.equal(assetImageUrl('/api/v1/external-generation/results/result-1/content'), '/api/v1/external-generation/results/result-1/content')
  assert.equal(assetImageUrl('/static/projects/demo/image.png'), '/static/projects/demo/image.png')
})
