const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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
      image_prompt: '神秘访客定妆',
      negative_prompt: '模糊',
      voice_profile: '低沉男声',
      variants: [{
        local_ref: 'new_variant_guest_default',
        name: '默认状态',
        description: '雨夜来访',
        appearance: '湿透的黑色大衣',
        image_prompt: '黑色大衣访客',
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
        image_prompt: '铜钥匙棚拍', negative_prompt: '手',
      },
      {
        local_ref: 'new_prop_key', name: '备用钥匙', type: '线索', description: '备用铜钥匙',
        image_prompt: '备用铜钥匙棚拍', negative_prompt: '手',
      },
    ];
    value.storyboards[0].storyboard_number = 2;
    const errors = validateExternalAiResult(value).errors;
    assert.ok(errors.some((item) => item.code === 'LOCAL_REF_DUPLICATE' && item.path === 'new_assets.props[1].local_ref'));
    assert.ok(errors.some((item) => item.code === 'STORYBOARD_NUMBER_INVALID' && item.path === 'storyboards[0].storyboard_number'));
  });
});
