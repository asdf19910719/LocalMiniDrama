const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePackageForProjection,
  PACKAGE_PROJECTION_REGISTRY,
} = require('../src/services/episodePackageProjection');

function legacyPackage() {
  return {
    schema: 'local-mini-drama.episode-package',
    version: '1.0',
    episode: { source_key: 'ep_1', episode_number: 1, title: '第一集', summary: '摘要' },
    characters: [{
      source_key: 'char_lin',
      name: '林晚',
      description: '身份说明',
      future_character_value: '保留审计',
      variants: [{
        source_key: 'char_lin_default',
        name: '默认状态',
        description: '日常状态',
        appearance: '默认状态外貌',
        image_prompt: '默认状态图片提示词',
        negative_prompt: '默认状态负向提示词',
        is_default: true,
      }],
    }],
    scenes: [],
    props: [{
      source_key: 'prop_key', name: '钥匙', description: '铜钥匙', image_prompt: '孤立钥匙',
    }],
    storyboards: [],
    future_root: { enabled: true },
  };
}

describe('episode package projection normalization', () => {
  it('从默认人物状态确定性回填顶层图像字段但不推断业务语义', () => {
    const input = legacyPackage();
    const { normalizedPackage, report } = normalizePackageForProjection(input);
    const character = normalizedPackage.characters[0];

    assert.equal(character.appearance, '默认状态外貌');
    assert.equal(character.image_prompt, '默认状态图片提示词');
    assert.equal(character.negative_prompt, '默认状态负向提示词');
    assert.equal(character.role, null);
    assert.equal(character.personality, null);
    assert.equal(normalizedPackage.props[0].type, null);
    assert.equal(input.characters[0].appearance, undefined);
    assert.deepEqual(report.derived_fields.map((item) => item.target), [
      'characters[0].appearance',
      'characters[0].image_prompt',
      'characters[0].negative_prompt',
    ]);
    assert.deepEqual(report.missing_fields.map((item) => item.path), [
      'characters[0].role',
      'characters[0].personality',
      'props[0].type',
    ]);
  });

  it('未标记默认状态时稳定选择第一个且不覆盖已有顶层值', () => {
    const input = legacyPackage();
    input.characters[0].appearance = '已有基础外貌';
    input.characters[0].variants[0].is_default = false;
    input.characters[0].variants.push({
      source_key: 'second', name: '第二状态', description: '第二', appearance: '第二外貌', image_prompt: '第二提示',
    });
    const first = normalizePackageForProjection(input);
    const second = normalizePackageForProjection(input);
    assert.equal(first.normalizedPackage.characters[0].appearance, '已有基础外貌');
    assert.equal(first.normalizedPackage.characters[0].image_prompt, '默认状态图片提示词');
    assert.deepEqual(first, second);
  });

  it('未知扩展字段只进入审计清单，已知 notes 有正式投影登记', () => {
    const { report } = normalizePackageForProjection(legacyPackage());
    assert.deepEqual(report.audit_only_fields.map((item) => item.path), [
      'characters[0].future_character_value',
      'future_root',
    ]);
    assert.equal(PACKAGE_PROJECTION_REGISTRY.storyboard.notes, 'persisted');
    assert.equal(PACKAGE_PROJECTION_REGISTRY.episode.source_key, 'persisted');
  });
});
