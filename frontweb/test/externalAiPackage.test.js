import test from 'node:test'
import assert from 'node:assert/strict'
import { externalAiDownloadName, saveTextFile } from '../src/utils/externalAiPackage.js'

test('external AI downloads use a filesystem-safe and meaningful filename', () => {
  assert.equal(
    externalAiDownloadName('第二集：雨夜/重逢', 'context', 'md'),
    '第二集_雨夜_重逢-context.md',
  )
  assert.equal(externalAiDownloadName('', 'task', 'zip'), 'external-ai-task.zip')
})

test('saveTextFile is inert outside a browser but still returns its filename', () => {
  assert.equal(saveTextFile('hello', 'context.md'), 'context.md')
})
