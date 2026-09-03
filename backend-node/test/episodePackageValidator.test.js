const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  logicalSlots,
  validateBusinessRules,
  renderAction,
  renderDialogue,
  generateScriptFromStoryboards,
  validateUniversalDraftRefs,
} = require('../src/services/episodePackageValidator');

const SPECS_DIR = path.join(__dirname, '..', '..', 'docs', 'superpowers', 'specs');

function examplePackage() {
  return JSON.parse(fs.readFileSync(path.join(SPECS_DIR, 'episode-package.example.json'), 'utf8'));
}

// 在合法示例上制造单一违规后运行业务校验
function businessResult(mutate) {
  const pkg = examplePackage();
  mutate(pkg);
  return validateBusinessRules(pkg);
}

function errorsOf(mutate) {
  return businessResult(mutate).errors;
}

function findError(mutate, code) {
  return errorsOf(mutate).find((e) => e.code === code);
}

function warningsOf(mutate) {
  return businessResult(mutate).warnings;
}

function findWarning(mutate, code) {
  return warningsOf(mutate).find((w) => w.code === code);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('episodePackageValidator 合法基准', () => {
  it('示例制作包业务校验 0 errors 0 warnings', () => {
    const result = validateBusinessRules(examplePackage());
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it('非法输入不抛异常并返回空结果', () => {
    assert.deepEqual(validateBusinessRules(null), { errors: [], warnings: [] });
    assert.deepEqual(validateBusinessRules('x'), { errors: [], warnings: [] });
    assert.deepEqual(logicalSlots(null), []);
    assert.deepEqual(logicalSlots('x'), []);
    assert.equal(generateScriptFromStoryboards(null), '');
    assert.equal(generateScriptFromStoryboards([]), '');
    assert.equal(renderAction(42), '');
    assert.equal(renderDialogue(42), '');
    assert.deepEqual(validateUniversalDraftRefs(null, 3), { refs: [], overflow: [] });
  });
});

describe('logicalSlots', () => {
  it('示例分镜 sb_01:场景 → 人物状态 → 道具,1-based 连续编号', () => {
    const pkg = examplePackage();
    assert.deepEqual(logicalSlots(pkg.storyboards[0]), [
      { index: 1, type: 'scene', ref: 'scene_store_entrance_rain' },
      {
        index: 2,
        type: 'character_variant',
        ref: { character_ref: 'char_lin_wan', variant_ref: 'char_lin_wan_default' },
      },
      { index: 3, type: 'prop', ref: 'prop_hot_coffee' },
    ]);
  });

  it('character_refs 按 sort_order 升序排列', () => {
    const storyboard = {
      source_key: 'sb_x',
      scene_ref: 'scene_a',
      character_refs: [
        { character_ref: 'c1', variant_ref: 'v1', sort_order: 2 },
        { character_ref: 'c2', variant_ref: 'v2', sort_order: 1 },
      ],
      prop_refs: ['p1'],
    };
    const slots = logicalSlots(storyboard);
    assert.equal(slots.length, 4);
    assert.deepEqual(slots[1], {
      index: 2,
      type: 'character_variant',
      ref: { character_ref: 'c2', variant_ref: 'v2' },
    });
    assert.deepEqual(slots[2], {
      index: 3,
      type: 'character_variant',
      ref: { character_ref: 'c1', variant_ref: 'v1' },
    });
    assert.deepEqual(slots[3], { index: 4, type: 'prop', ref: 'p1' });
  });

  it('缺场景时人物状态从 1 号开始;全部缺省返回空数组', () => {
    assert.deepEqual(logicalSlots({ character_refs: [{ character_ref: 'c', variant_ref: 'v', sort_order: 1 }] }), [
      { index: 1, type: 'character_variant', ref: { character_ref: 'c', variant_ref: 'v' } },
    ]);
    assert.deepEqual(logicalSlots({}), []);
  });
});

describe('PACKAGE_KEY_DUPLICATE', () => {
  it('人物 source_key 重复', () => {
    const err = findError((pkg) => {
      pkg.characters.push(deepClone(pkg.characters[0]));
    }, 'PACKAGE_KEY_DUPLICATE');
    assert.ok(err, '应报人物键重复');
    assert.equal(err.path, 'characters[1].source_key');
    assert.ok(err.message.includes('char_lin_wan'));
    assert.equal(errorsOf((pkg) => {
      pkg.characters.push(deepClone(pkg.characters[0]));
    }).length, 1);
  });

  it('状态 source_key 在人物内重复', () => {
    const err = findError((pkg) => {
      pkg.characters[0].variants.push(deepClone(pkg.characters[0].variants[0]));
    }, 'PACKAGE_KEY_DUPLICATE');
    assert.ok(err, '应报状态键重复');
    assert.equal(err.path, 'characters[0].variants[2].source_key');
    assert.ok(err.message.includes('char_lin_wan_default'));
  });

  it('场景 source_key 重复', () => {
    const err = findError((pkg) => {
      pkg.scenes.push(deepClone(pkg.scenes[0]));
    }, 'PACKAGE_KEY_DUPLICATE');
    assert.ok(err);
    assert.equal(err.path, 'scenes[2].source_key');
    assert.ok(err.message.includes('scene_store_entrance_rain'));
  });

  it('道具 source_key 重复', () => {
    const err = findError((pkg) => {
      pkg.props.push(deepClone(pkg.props[0]));
    }, 'PACKAGE_KEY_DUPLICATE');
    assert.ok(err);
    assert.equal(err.path, 'props[1].source_key');
    assert.ok(err.message.includes('prop_hot_coffee'));
  });

  it('分镜 source_key 重复', () => {
    const err = findError((pkg) => {
      const clone = deepClone(pkg.storyboards[0]);
      clone.storyboard_number = 9; // 隔离镜号重复
      pkg.storyboards.push(clone);
    }, 'PACKAGE_KEY_DUPLICATE');
    assert.ok(err);
    assert.equal(err.path, 'storyboards[2].source_key');
    assert.ok(err.message.includes('sb_01'));
    assert.equal(errorsOf((pkg) => {
      const clone = deepClone(pkg.storyboards[0]);
      clone.storyboard_number = 9;
      pkg.storyboards.push(clone);
    }).length, 1);
  });
});

describe('PACKAGE_REF_MISSING', () => {
  it('scene_ref 无目标,path 含分镜 source_key', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].scene_ref = 'scene_ghost';
    }, 'PACKAGE_REF_MISSING');
    assert.ok(err, '应报场景引用缺失');
    assert.ok(err.path.includes('sb_01'), `path 应含分镜 source_key,实际 ${err.path}`);
    assert.ok(err.path.endsWith('.scene_ref'));
    assert.ok(err.message.includes('scene_ghost'));
    assert.equal(errorsOf((pkg) => {
      pkg.storyboards[0].scene_ref = 'scene_ghost';
    }).length, 1);
  });

  it('character_ref 无目标,path 指向 character_refs 条目', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].character_refs[0].character_ref = 'char_ghost';
    }, 'PACKAGE_REF_MISSING');
    assert.ok(err);
    assert.ok(err.path.includes('sb_01'));
    assert.ok(err.path.endsWith('character_refs[0].character_ref'));
    assert.ok(err.message.includes('char_ghost'));
  });

  it('prop_ref 无目标,path 指向 prop_refs 数组下标', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].prop_refs = ['prop_ghost'];
    }, 'PACKAGE_REF_MISSING');
    assert.ok(err);
    assert.ok(err.path.includes('sb_01'));
    assert.ok(err.path.endsWith('prop_refs[0]'));
    assert.ok(err.message.includes('prop_ghost'));
  });
});

describe('VARIANT_CHARACTER_MISMATCH', () => {
  it('variant_ref 不属于该 character_ref', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].character_refs[0].variant_ref = 'char_lin_wan_ghost';
    }, 'VARIANT_CHARACTER_MISMATCH');
    assert.ok(err, '应报状态归属不匹配');
    assert.ok(err.path.includes('sb_01'));
    assert.ok(err.path.endsWith('character_refs[0].variant_ref'));
    assert.ok(err.message.includes('char_lin_wan_ghost'));
    assert.equal(errorsOf((pkg) => {
      pkg.storyboards[0].character_refs[0].variant_ref = 'char_lin_wan_ghost';
    }).length, 1);
  });

  it('character_ref 缺失时报 REF_MISSING 而非 MISMATCH', () => {
    const errors = errorsOf((pkg) => {
      pkg.storyboards[0].character_refs[0].character_ref = 'char_ghost';
      pkg.storyboards[0].character_refs[0].variant_ref = 'v_any';
    });
    assert.deepEqual(errors.map((e) => e.code), ['PACKAGE_REF_MISSING']);
  });
});

describe('PACKAGE_REF_DUPLICATE', () => {
  it('同一分镜内重复 (character_ref, variant_ref) 对被拦截', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].character_refs.push(deepClone(pkg.storyboards[0].character_refs[0]));
    }, 'PACKAGE_REF_DUPLICATE');
    assert.ok(err, '应报同分镜内人物状态引用重复');
    assert.ok(err.path.includes('sb_01'), `path 应含分镜 source_key,实际 ${err.path}`);
    assert.ok(err.path.endsWith('character_refs[1]'));
    assert.ok(err.message.includes('char_lin_wan_default'), 'message 应说明重复项');
    assert.equal(errorsOf((pkg) => {
      pkg.storyboards[0].character_refs.push(deepClone(pkg.storyboards[0].character_refs[0]));
    }).length, 1, '重复条目自身合法,不应叠加其他错误');
  });

  it('同一分镜内重复 prop_ref 被拦截', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].prop_refs = ['prop_hot_coffee', 'prop_hot_coffee'];
    }, 'PACKAGE_REF_DUPLICATE');
    assert.ok(err, '应报同分镜内道具引用重复');
    assert.ok(err.path.includes('sb_01'), `path 应含分镜 source_key,实际 ${err.path}`);
    assert.ok(err.path.endsWith('prop_refs[1]'));
    assert.ok(err.message.includes('prop_hot_coffee'), 'message 应说明重复项');
    assert.equal(errorsOf((pkg) => {
      pkg.storyboards[0].prop_refs = ['prop_hot_coffee', 'prop_hot_coffee'];
    }).length, 1, '重复条目自身合法,不应叠加其他错误');
  });

  it('跨分镜引用同一人物状态对仍合法', () => {
    const errors = errorsOf((pkg) => {
      // sb_02 新增与 sb_01 完全相同的 (character_ref, variant_ref) 对,但在 sb_02 内唯一
      pkg.storyboards[1].character_refs.push({
        character_ref: 'char_lin_wan',
        variant_ref: 'char_lin_wan_default',
        sort_order: 2,
        reference_role: 'identity',
      });
      // 道具跨分镜复用由基准数据覆盖:sb_01 与 sb_02 均引用 prop_hot_coffee
    });
    assert.deepEqual(errors, [], '跨分镜重复同一资产是合法的,不应产生任何错误');
  });
});

describe('PACKAGE_NUMBER_DUPLICATE', () => {
  it('镜号重复', () => {
    const err = findError((pkg) => {
      pkg.storyboards[1].storyboard_number = 1;
    }, 'PACKAGE_NUMBER_DUPLICATE');
    assert.ok(err, '应报镜号重复');
    assert.equal(err.path, 'storyboards[1].storyboard_number');
    assert.ok(err.message.includes('1'));
  });
});

describe('PACKAGE_DURATION_INVALID', () => {
  it('时长为 0', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].duration_seconds = 0;
    }, 'PACKAGE_DURATION_INVALID');
    assert.ok(err);
    assert.equal(err.path, 'storyboards[0].duration_seconds');
  });

  it('时长为负数', () => {
    const err = findError((pkg) => {
      pkg.storyboards[1].duration_seconds = -1.5;
    }, 'PACKAGE_DURATION_INVALID');
    assert.ok(err);
    assert.equal(err.path, 'storyboards[1].duration_seconds');
  });

  it('时长非有限数(Infinity)', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].duration_seconds = Infinity;
    }, 'PACKAGE_DURATION_INVALID');
    assert.ok(err);
  });
});

describe('PACKAGE_SLOT_OVERFLOW', () => {
  it('草稿引用 3 号槽但分镜只有 2 个槽,path 含分镜 source_key', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].prop_refs = []; // 剩 场景+人物状态 共 2 槽
      pkg.storyboards[0].universal_segment_text = '@图片3 是热咖啡。';
    }, 'PACKAGE_SLOT_OVERFLOW');
    assert.ok(err, '应报槽位越界');
    assert.ok(err.path.includes('sb_01'), `path 应含分镜 source_key,实际 ${err.path}`);
    assert.ok(err.path.endsWith('.universal_segment_text'));
    assert.ok(err.message.includes('3'), 'message 应指出越界槽号');
    assert.ok(err.message.includes('2'), 'message 应指出槽位总数');
  });

  it('越界与槽位缺口可在同一分镜同时报告', () => {
    const result = businessResult((pkg) => {
      pkg.storyboards[0].universal_segment_text = '@图片2 与 @图片5。';
    });
    assert.deepEqual(result.errors.map((e) => e.code), ['PACKAGE_SLOT_OVERFLOW']);
    assert.deepEqual(result.warnings.map((w) => w.code), ['UNIVERSAL_DRAFT_SLOT_GAP']);
  });
});

describe('PACKAGE_REQUIRED_FIELD_MISSING', () => {
  for (const field of ['shot_type', 'camera_angle', 'camera_movement', 'composition', 'action']) {
    it(`分镜缺少 ${field} 时报错且 path 精确`, () => {
      const errors = errorsOf((pkg) => {
        delete pkg.storyboards[0][field];
      });
      assert.equal(errors.length, 1, `缺少 ${field} 应只产生一条错误`);
      const err = errors[0];
      assert.equal(err.code, 'PACKAGE_REQUIRED_FIELD_MISSING');
      assert.equal(err.path, `storyboards[0].${field}`);
      assert.ok(err.message.includes('sb_01'), 'message 应说明分镜');
      assert.ok(err.message.includes(field), 'message 应说明字段');
    });
  }

  it('空字符串视为缺失(shot_type="")', () => {
    const err = findError((pkg) => {
      pkg.storyboards[0].shot_type = '';
    }, 'PACKAGE_REQUIRED_FIELD_MISSING');
    assert.ok(err);
    assert.equal(err.path, 'storyboards[0].shot_type');
  });

  it('character_refs[].reference_role 缺失时报错', () => {
    const errors = errorsOf((pkg) => {
      delete pkg.storyboards[0].character_refs[0].reference_role;
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'PACKAGE_REQUIRED_FIELD_MISSING');
    assert.equal(errors[0].path, 'storyboards[0].character_refs[0].reference_role');
    assert.ok(errors[0].message.includes('sb_01'));
    assert.ok(errors[0].message.includes('reference_role'));
  });
});

describe('可确认警告', () => {
  it('episode.script 缺失 → SCRIPT_MISSING', () => {
    const warning = findWarning((pkg) => {
      delete pkg.episode.script;
    }, 'SCRIPT_MISSING');
    assert.ok(warning);
    assert.equal(warning.path, 'episode.script');
    assert.equal(errorsOf((pkg) => {
      delete pkg.episode.script;
    }).length, 0, '缺失剧本只是警告,不阻塞');
  });

  it('episode.script 为空字符串 → SCRIPT_MISSING', () => {
    const warning = findWarning((pkg) => {
      pkg.episode.script = '   ';
    }, 'SCRIPT_MISSING');
    assert.ok(warning);
  });

  it('audio_description 缺失 → AUDIO_MISSING', () => {
    const warning = findWarning((pkg) => {
      delete pkg.storyboards[0].audio_description;
    }, 'AUDIO_MISSING');
    assert.ok(warning);
    assert.equal(warning.path, 'storyboards[0].audio_description');
  });

  it('transition 缺失 → TRANSITION_MISSING', () => {
    const warning = findWarning((pkg) => {
      delete pkg.storyboards[1].transition;
    }, 'TRANSITION_MISSING');
    assert.ok(warning);
    assert.equal(warning.path, 'storyboards[1].transition');
  });

  it('universal_segment_text 缺失 → UNIVERSAL_DRAFT_MISSING', () => {
    const warning = findWarning((pkg) => {
      delete pkg.storyboards[0].universal_segment_text;
    }, 'UNIVERSAL_DRAFT_MISSING');
    assert.ok(warning);
    assert.equal(warning.path, 'storyboards[0].universal_segment_text');
  });

  it('槽位未被草稿全部引用 → UNIVERSAL_DRAFT_SLOT_GAP', () => {
    const warning = findWarning((pkg) => {
      pkg.storyboards[0].universal_segment_text = '@图片1 和 @图片3。';
    }, 'UNIVERSAL_DRAFT_SLOT_GAP');
    assert.ok(warning, '应报槽位缺口');
    assert.equal(warning.path, 'storyboards[0].universal_segment_text');
    assert.ok(warning.message.includes('2'), 'message 应指出未被引用的槽位序号');
  });
});

describe('renderAction', () => {
  it('字符串原样返回', () => {
    assert.equal(renderAction('他推门进店。'), '他推门进店。');
    assert.equal(renderAction('  保留原样  '), '  保留原样  ');
  });

  it('{start,progression,end} 渲染为三行确定性文本', () => {
    assert.equal(
      renderAction({ start: '门开', progression: '客进', end: '门合' }),
      '开始：门开\n推进：客进\n结束：门合'
    );
  });

  it('缺段时跳过对应行', () => {
    assert.equal(renderAction({ start: '门开' }), '开始：门开');
    assert.equal(renderAction({ progression: '客进', end: '门合' }), '推进：客进\n结束：门合');
    assert.equal(renderAction({}), '');
  });

  it('空白段与非字符串段确定性处理', () => {
    assert.equal(renderAction({ start: '  ', progression: '推进', end: null }), '推进：推进');
    assert.equal(renderAction({ start: 1, progression: 2, end: 3 }), '开始：1\n推进：2\n结束：3');
  });

  it('额外字段不参与渲染', () => {
    assert.equal(renderAction({ start: 'A', foo: 'bar' }), '开始：A');
  });

  it('null/undefined 返回空串', () => {
    assert.equal(renderAction(null), '');
    assert.equal(renderAction(undefined), '');
  });

  it('同一输入两次调用输出逐字节相同', () => {
    const input = { start: '门开', progression: '客进', end: '门合' };
    assert.strictEqual(renderAction(input), renderAction(input));
    assert.strictEqual(renderAction('静态动作'), renderAction('静态动作'));
  });
});

describe('renderDialogue', () => {
  it('结构化对白渲染为『说话人』（表演）：台词', () => {
    assert.equal(
      renderDialogue([{ speaker: '林晚', line: '欢迎光临。', performance: '轻声' }]),
      '『林晚』（轻声）：欢迎光临。'
    );
  });

  it('无 speaker 用旁白,无 performance 不加括号', () => {
    assert.equal(renderDialogue([{ line: '雨声渐起。' }]), '『旁白』：雨声渐起。');
    assert.equal(renderDialogue([{ speaker: '林晚', line: '请。' }]), '『林晚』：请。');
  });

  it('多句逐行拼接', () => {
    assert.equal(
      renderDialogue([
        { speaker: '甲', line: '你好。' },
        { speaker: '乙', line: '你好。' },
      ]),
      '『甲』：你好。\n『乙』：你好。'
    );
  });

  it('字符串原样,null/undefined 返回空串', () => {
    assert.equal(renderDialogue('旁白:雨夜。'), '旁白:雨夜。');
    assert.equal(renderDialogue(null), '');
    assert.equal(renderDialogue(undefined), '');
  });

  it('同一输入两次调用输出逐字节相同', () => {
    const input = [{ speaker: '林晚', line: '先喝点热的吧。', performance: '小心' }];
    assert.strictEqual(renderDialogue(input), renderDialogue(input));
  });
});

describe('generateScriptFromStoryboards', () => {
  const storyboards = [
    {
      storyboard_number: 1,
      scene_name: '便利店门口',
      title: '客人进门',
      action: { start: '门开', progression: '客进', end: '门合' },
      dialogue: [{ speaker: '林晚', line: '欢迎光临。' }],
      narration: '雨夜。',
    },
    {
      storyboard_number: 2,
      scene_ref: 'scene_store_night',
      title: '递咖啡',
      action: '林晚递上咖啡',
      dialogue: [],
      narration: '',
    },
  ];

  const expected = [
    '【镜1·便利店门口】客人进门',
    '动作：开始：门开\n推进：客进\n结束：门合',
    '对白：『林晚』：欢迎光临。',
    '旁白：雨夜。',
    '',
    '【镜2·scene_store_night】递咖啡',
    '动作：林晚递上咖啡',
  ].join('\n');

  it('逐镜确定性拼接,空段跳行,两镜间空行', () => {
    assert.equal(generateScriptFromStoryboards(storyboards), expected);
  });

  it('同一输入两次调用输出逐字节相同', () => {
    assert.strictEqual(
      generateScriptFromStoryboards(storyboards),
      generateScriptFromStoryboards(storyboards)
    );
  });

  it('场景名优先 scene_name,缺省回落 scene_ref;镜号非法时用序号兜底', () => {
    const script = generateScriptFromStoryboards([
      { scene_name: 'A', scene_ref: 'scene_x', title: 'T', narration: 'n' },
      { storyboard_number: 7, scene_ref: 'scene_y', title: 'T2' },
    ]);
    assert.ok(script.startsWith('【镜1·A】T'));
    assert.ok(script.includes('【镜7·scene_y】T2'));
  });

  it('跳过非对象条目', () => {
    const script = generateScriptFromStoryboards([null, storyboards[1]]);
    assert.equal(script, '【镜2·scene_store_night】递咖啡\n动作：林晚递上咖啡');
  });
});

describe('validateUniversalDraftRefs', () => {
  it('识别 图片/image 两种写法,按出现顺序返回', () => {
    const result = validateUniversalDraftRefs('@图片1 在门口,@图片2 是林晚; @image 3 是咖啡', 3);
    assert.deepEqual(result.refs, [1, 2, 3]);
    assert.deepEqual(result.overflow, []);
  });

  it('大小写不敏感且允许数字前空格', () => {
    assert.deepEqual(validateUniversalDraftRefs('@IMAGE4 和 @图片 2', 3).refs, [4, 2]);
  });

  it('超过 slotCount 的引用进入 overflow', () => {
    const result = validateUniversalDraftRefs('@图片1 @图片2 @图片3', 2);
    assert.deepEqual(result.overflow, [3]);
  });

  it('重复引用按出现次数保留', () => {
    const result = validateUniversalDraftRefs('@图片1 @图片1', 1);
    assert.deepEqual(result.refs, [1, 1]);
    assert.deepEqual(result.overflow, []);
  });
});
