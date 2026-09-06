import test from 'node:test'
import assert from 'node:assert/strict'

import {
  formatJsonText,
  importSourceDownloadName,
  importReportSections,
  hasImportSource,
} from '../src/utils/episodeImportSource.js'

test('formatJsonText 格式化合法 JSON，损坏原文保持逐字不变', () => {
  assert.equal(formatJsonText('{"a":1}'), '{\n  "a": 1\n}')
  assert.equal(formatJsonText('{bad\n'), '{bad\n')
  assert.equal(formatJsonText(''), '')
})

test('下载文件名只使用安全 basename', () => {
  assert.equal(importSourceDownloadName('..\\资料\\第一集.json'), '第一集-raw.json')
  assert.equal(importSourceDownloadName('../source'), 'source-raw.json')
  assert.equal(importSourceDownloadName(''), 'episode-package-raw.json')
})

test('导入报告按映射结果分组并保留解析警告', () => {
  const sections = importReportSections({
    created: [{ type: 'character', source_key: 'c1' }],
    reused: [],
    derived_fields: [{ target: 'characters[0].appearance' }],
    missing_fields: [{ path: 'characters[0].personality' }],
    audit_only_fields: [{ path: 'custom' }],
    warnings: [{ code: 'CHARACTER_PERSONALITY_MISSING' }],
  }, [{ field: 'match_decisions' }])
  assert.deepEqual(sections.map((item) => [item.key, item.items.length]), [
    ['created', 1], ['reused', 0], ['match_decisions', 0], ['generator_metadata', 0],
    ['derived_fields', 1], ['missing_fields', 1],
    ['audit_only_fields', 1], ['warnings', 2],
  ])
})

test('导入报告展示原始匹配决策与生成器元数据', () => {
  const matchDecisions = { characters: { char_a: 'create' } }
  const generatorMetadata = { provider: 'external-ai' }
  const sections = importReportSections({}, [], matchDecisions, generatorMetadata)

  assert.deepEqual(sections.find((item) => item.key === 'match_decisions').items, [matchDecisions])
  assert.deepEqual(sections.find((item) => item.key === 'generator_metadata').items, [generatorMetadata])
})

test('hasImportSource 只认后端摘要', () => {
  assert.equal(hasImportSource({ import_source: { source_filename: 'a.json' } }), true)
  assert.equal(hasImportSource({}), false)
  assert.equal(hasImportSource(null), false)
})
