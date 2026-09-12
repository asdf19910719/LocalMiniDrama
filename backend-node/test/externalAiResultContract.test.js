const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  EXTERNAL_AI_RESULT_SCHEMA,
  validateExternalAiResult,
} = require('../src/services/externalAiResultContract');
const { validExternalAiResult: validResult } = require('./fixtures/externalAiResultFixture');

describe('externalAiResultContract', () => {
  it('accepts one strict result that references existing assets', () => {
    const result = validateExternalAiResult(validResult());
    assert.deepEqual(result, { ok: true, errors: [] });
    assert.equal(EXTERNAL_AI_RESULT_SCHEMA.additionalProperties, false);
    assert.equal(EXTERNAL_AI_RESULT_SCHEMA.properties.package_id.type, 'string');
  });

  it('accepts the task receipt assets_digest declared by the schema', () => {
    // 任务说明要求外部 AI 逐字符复制 assets_digest 回执；Schema 必须声明该字段，否则说明与 Schema 自相矛盾
    assert.ok(EXTERNAL_AI_RESULT_SCHEMA.properties.assets_digest, 'Schema 应声明 assets_digest 字段');
    const value = validResult();
    value.assets_digest = 'e'.repeat(64);
    const result = validateExternalAiResult(value);
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it('rejects unknown fields at root and nested result-owned objects', () => {
    const value = validResult();
    value.surprise = true;
    value.episode.unused = 'x';
    value.storyboards[0].action.camera = 'invented';
    const errors = validateExternalAiResult(value).errors;
    assert.deepEqual(errors.map((item) => item.path), ['surprise', 'episode.unused', 'storyboards[0].action.camera']);
  });

  it('requires complete personality and appearance fields for a new character', () => {
    const value = validResult();
    value.new_assets.characters.push({
      local_ref: 'new_char_guest',
      name: '陌生人',
      role: 'supporting',
      description: '送来账本的神秘访客。',
      base_image_prompt: '神秘访客定妆',
      negative_prompt: '模糊',
      voice_profile: '低沉男声',
      variants: [{
        local_ref: 'new_variant_guest_default',
        name: '默认状态',
        description: '雨夜来访',
        appearance: '湿透的黑色大衣',
        base_image_prompt: '黑色大衣访客',
        negative_prompt: '模糊',
        is_default: true,
      }],
    });
    const errors = validateExternalAiResult(value).errors;
    assert.deepEqual(errors.map((item) => item.path), [
      'new_assets.characters[0].personality',
      'new_assets.characters[0].appearance',
    ]);
  });

  it('rejects wrong primitive types and invalid numeric ranges', () => {
    const value = validResult();
    value.episode.episode_number = '2';
    value.storyboards[0].duration_seconds = 0;
    value.storyboards[0].is_primary = 1;
    const errors = validateExternalAiResult(value).errors;
    assert.deepEqual(errors.map((item) => item.path), [
      'episode.episode_number',
      'storyboards[0].duration_seconds',
      'storyboards[0].is_primary',
    ]);
  });

  it('rejects duplicate local refs and non-contiguous storyboard numbers', () => {
    const value = validResult();
    value.new_assets.props = [
      {
        local_ref: 'new_prop_key', name: '钥匙', type: '线索', description: '铜钥匙',
        base_image_prompt: '铜钥匙棚拍', negative_prompt: '手',
      },
      {
        local_ref: 'new_prop_key', name: '备用钥匙', type: '线索', description: '备用铜钥匙',
        base_image_prompt: '备用铜钥匙棚拍', negative_prompt: '手',
      },
    ];
    value.storyboards[0].storyboard_number = 2;
    const errors = validateExternalAiResult(value).errors;
    assert.ok(errors.some((item) => item.code === 'LOCAL_REF_DUPLICATE' && item.path === 'new_assets.props[1].local_ref'));
    assert.ok(errors.some((item) => item.code === 'STORYBOARD_NUMBER_INVALID' && item.path === 'storyboards[0].storyboard_number'));
  });

  it('keeps the published schema and example synchronized with the runtime contract', () => {
    const docsDir = path.resolve(__dirname, '../../docs/单集制作包导入');
    const publishedSchema = JSON.parse(fs.readFileSync(path.join(docsDir, '制作包schema.json'), 'utf8'));
    const publishedExample = JSON.parse(fs.readFileSync(path.join(docsDir, '制作包示例.json'), 'utf8'));
    assert.deepEqual(publishedSchema, EXTERNAL_AI_RESULT_SCHEMA);
    assert.deepEqual(validateExternalAiResult(publishedExample), { ok: true, errors: [] });
  });

  it('rejects v1, style overrides, legacy prompt fields, and final prompts', () => {
    const value = validResult();
    value.version = '1';
    value.style_id = 'rh-101-cinematic';
    value.storyboards[0].image_prompt = 'legacy';
    value.storyboards[0].final_prompt = 'compiled';
    const errors = validateExternalAiResult(value).errors;
    assert.ok(errors.some((item) => item.code === 'LEGACY_SCHEMA_UNSUPPORTED'));
    assert.ok(errors.some((item) => item.code === 'STYLE_OVERRIDE_FORBIDDEN'));
    assert.ok(errors.some((item) => item.code === 'FINAL_PROMPT_FORBIDDEN'));
  });
});
