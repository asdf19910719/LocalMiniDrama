const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schemaDir = path.resolve(__dirname, '../../superpowers/specs/schemas');
const schemaNames = [
  'episode-package-v2.1.schema.json',
  'external-ai-result-v2.1.schema.json',
  'shot-package-v2.1.schema.json',
];

test('三份 V2.1 Schema 使用统一的字符串版本', () => {
  for (const name of schemaNames) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, name), 'utf8'));
    assert.equal(schema.properties.version.const, '2.1', name);
  }
});
