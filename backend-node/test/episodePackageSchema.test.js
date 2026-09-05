const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  PACKAGE_SCHEMA_NAME,
  PACKAGE_SCHEMA_VERSION,
  packageJsonSchema,
  validatePackageStructure,
} = require('../src/services/episodePackageSchema');

const SPECS_DIR = path.join(__dirname, '..', '..', 'docs', '单集制作包导入');

const DOC_NAMES = {
  example: '制作包示例.json',
  schema: '制作包schema.json',
};

function loadDoc(name) {
  return JSON.parse(fs.readFileSync(path.join(SPECS_DIR, name), 'utf8'));
}

function examplePackage() {
  return loadDoc(DOC_NAMES.example);
}

// 读取 'a.b[0].c' 形式的点路径,用于断言示例覆盖全部字段
function pickByPath(obj, dotted) {
  return dotted
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

// 在合法示例上制造单一违规,断言 ok=false 后返回 errors,供逐条检查 path
function violationErrors(mutate) {
  const pkg = examplePackage();
  mutate(pkg);
  const result = validatePackageStructure(pkg);
  assert.equal(result.ok, false, '违规包不应通过结构校验');
  return result.errors;
}

describe('episodePackageSchema', () => {
  it('导出固定的 schema 名称与版本', () => {
    assert.equal(PACKAGE_SCHEMA_NAME, 'local-mini-drama.episode-package');
    assert.equal(PACKAGE_SCHEMA_VERSION, '1.0');
  });

  it('packageJsonSchema 为 draft-07 且与 schema.json 文件同构', () => {
    assert.equal(packageJsonSchema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.deepEqual(loadDoc(DOC_NAMES.schema), packageJsonSchema);
  });

  it('合法示例包通过结构校验', () => {
    const result = validatePackageStructure(examplePackage());
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  it('示例覆盖协议全部字段', () => {
    const covered = [
      'generator.name', 'generator.model', 'generator.generated_at',
      'generation_profile.video_mode', 'generation_profile.uses_first_last_frame',
      'generation_profile.max_reference_images', 'generation_profile.reference_order',
      'audio_plan.version', 'audio_plan.bgm.mode', 'audio_plan.bgm.prompt',
      'audio_plan.bgm.planning', 'audio_plan.bgm.continuity_key',
      'audio_plan.bgm.source_type', 'audio_plan.bgm.volume_db',
      'audio_plan.bgm.ducking_db', 'audio_plan.bgm.fade_in_ms',
      'audio_plan.bgm.fade_out_ms', 'audio_plan.bgm.crossfade_ms',
      'audio_plan.mastering.target_lufs', 'audio_plan.mastering.true_peak_db',
      'audio_plan.speech.dialogue_owner', 'audio_plan.speech.narration_owner',
      'episode.source_key', 'episode.episode_number', 'episode.title', 'episode.summary',
      'episode.script', 'episode.duration_target_seconds', 'episode.notes',
      'characters[0].source_key', 'characters[0].name', 'characters[0].description',
      'characters[0].appearance', 'characters[0].image_prompt',
      'characters[0].negative_prompt', 'characters[0].voice_profile',
      'characters[0].variants[0].source_key', 'characters[0].variants[0].name',
      'characters[0].variants[0].description', 'characters[0].variants[0].appearance',
      'characters[0].variants[0].image_prompt', 'characters[0].variants[0].negative_prompt',
      'characters[0].variants[0].is_default',
      'characters[0].variants[1].source_key',
      'scenes[0].source_key', 'scenes[0].name', 'scenes[0].state',
      'scenes[0].description', 'scenes[0].atmosphere',
      'scenes[0].image_prompt', 'scenes[0].negative_prompt',
      'scenes[1].source_key',
      'props[0].source_key', 'props[0].name', 'props[0].description',
      'props[0].image_prompt', 'props[0].negative_prompt',
      'storyboards[0].source_key', 'storyboards[0].storyboard_number',
      'storyboards[0].title', 'storyboards[0].description',
      'storyboards[0].duration_seconds', 'storyboards[0].scene_ref',
      'storyboards[0].character_refs[0].character_ref',
      'storyboards[0].character_refs[0].variant_ref',
      'storyboards[0].character_refs[0].reference_role',
      'storyboards[0].character_refs[0].sort_order',
      'storyboards[0].character_refs[0].framing_note',
      'storyboards[0].prop_refs[0]',
      'storyboards[0].shot_type', 'storyboards[0].camera_angle',
      'storyboards[0].camera_movement', 'storyboards[0].composition',
      'storyboards[0].action.start', 'storyboards[0].action.progression',
      'storyboards[0].action.end',
      'storyboards[0].dialogue[0].speaker', 'storyboards[0].dialogue[0].line',
      'storyboards[0].dialogue[0].performance',
      'storyboards[0].narration', 'storyboards[0].is_primary',
      'storyboards[0].audio_description.ambience',
      'storyboards[0].audio_description.sound_effects',
      'storyboards[0].audio_description.dialogue_treatment',
      'storyboards[0].audio_description.silence',
      'storyboards[0].audio_description.music_cue.mode',
      'storyboards[0].audio_description.music_cue.intensity',
      'storyboards[0].audio_description.music_cue.start',
      'storyboards[0].audio_description.music_cue.end',
      'storyboards[0].transition.type', 'storyboards[0].transition.duration',
      'storyboards[0].transition.audio_bridge.mode',
      'storyboards[0].transition.audio_bridge.duration_ms',
      'storyboards[0].transition.audio_bridge.description',
      'storyboards[0].image_prompt',
      'storyboards[0].universal_segment_text', 'storyboards[0].notes',
      'storyboards[1].storyboard_number',
      'storyboards[1].audio_description.music_cue.prompt',
      'storyboards[1].transition.visual_description',
    ];
    const pkg = examplePackage();
    for (const p of covered) {
      assert.notEqual(pickByPath(pkg, p), undefined, `示例缺少字段 ${p}`);
    }
    assert.equal(pkg.characters.length, 1);
    assert.equal(pkg.characters[0].variants.length, 2);
    assert.equal(pkg.scenes.length, 2);
    assert.equal(pkg.props.length, 1);
    assert.equal(pkg.storyboards.length, 2);
  });

  // —— 逐类违规:ok=false 且 path 精确 ——

  it('缺 schema → path=schema', () => {
    const errors = violationErrors((pkg) => { delete pkg.schema; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'schema');
  });

  it('错误 version → path=version', () => {
    const errors = violationErrors((pkg) => { pkg.version = '2.0'; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'version');
  });

  it('缺 episode → path=episode', () => {
    const errors = violationErrors((pkg) => { delete pkg.episode; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'episode');
  });

  it('episode_number 非正整数 → path=episode.episode_number', () => {
    const errors = violationErrors((pkg) => { pkg.episode.episode_number = 0; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'episode.episode_number');
  });

  it('characters 项缺 variants → path=characters[0].variants', () => {
    const errors = violationErrors((pkg) => { delete pkg.characters[0].variants; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'characters[0].variants');
  });

  it('variants 为空数组 → path=characters[0].variants', () => {
    const errors = violationErrors((pkg) => { pkg.characters[0].variants = []; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'characters[0].variants');
  });

  it('character_refs 项缺 variant_ref → path 精确到该项', () => {
    const errors = violationErrors((pkg) => {
      delete pkg.storyboards[0].character_refs[0].variant_ref;
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'storyboards[0].character_refs[0].variant_ref');
  });

  it('character_refs 项缺 sort_order → path 精确到该项', () => {
    const errors = violationErrors((pkg) => {
      delete pkg.storyboards[0].character_refs[0].sort_order;
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'storyboards[0].character_refs[0].sort_order');
  });

  it('duration_seconds 非正数 → path=storyboards[0].duration_seconds', () => {
    const errors = violationErrors((pkg) => { pkg.storyboards[0].duration_seconds = 0; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'storyboards[0].duration_seconds');
  });

  it('缺 storyboards → path=storyboards', () => {
    const errors = violationErrors((pkg) => { delete pkg.storyboards; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'storyboards');
  });

  // —— 其余规则 ——

  it('generation_profile.max_reference_images 非正整数 → path 精确', () => {
    const errors = violationErrors((pkg) => { pkg.generation_profile.max_reference_images = 0; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'generation_profile.max_reference_images');
  });

  it('audio_plan 已提供的结构化字段会校验类型和枚举', () => {
    const pkg = examplePackage();
    pkg.audio_plan.version = 2;
    pkg.audio_plan.bgm.source_type = 'remote_url';
    pkg.audio_plan.bgm.crossfade_ms = -1;
    pkg.audio_plan.mastering.target_lufs = 'loud';
    pkg.audio_plan.speech.dialogue_owner = 'both';
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((item) => item.path).sort(), [
      'audio_plan.bgm.crossfade_ms',
      'audio_plan.bgm.source_type',
      'audio_plan.mastering.target_lufs',
      'audio_plan.speech.dialogue_owner',
      'audio_plan.version',
    ]);
  });

  it('带 audio_plan 的新包必须包含完整人物和声音策略', () => {
    const pkg = examplePackage();
    delete pkg.audio_plan.version;
    delete pkg.audio_plan.bgm.mode;
    delete pkg.audio_plan.speech.narration_owner;
    delete pkg.characters[0].appearance;
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((item) => item.path).sort(), [
      'audio_plan.bgm.mode',
      'audio_plan.speech.narration_owner',
      'audio_plan.version',
      'characters[0].appearance',
    ]);
  });

  it('per_segment 新包必须提供剧集母题和每镜 music_cue', () => {
    const pkg = examplePackage();
    delete pkg.audio_plan.bgm.prompt;
    delete pkg.audio_plan.bgm.continuity_key;
    delete pkg.storyboards[0].audio_description.music_cue;
    delete pkg.storyboards[1].audio_description;
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((item) => item.path).sort(), [
      'audio_plan.bgm.continuity_key',
      'audio_plan.bgm.prompt',
      'storyboards[0].audio_description.music_cue',
      'storyboards[1].audio_description',
    ]);
  });

  it('per_segment 的 override 和 stinger cue 必须提供非空 prompt', () => {
    const pkg = examplePackage();
    pkg.storyboards[1].audio_description.music_cue.prompt = '';
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((item) => item.path), [
      'storyboards[1].audio_description.music_cue.prompt',
    ]);
  });

  it('分镜结构化声音和转场字段会校验类型和枚举', () => {
    const pkg = examplePackage();
    pkg.storyboards[0].audio_description.music_cue.mode = 'auto';
    pkg.storyboards[0].audio_description.music_cue.intensity = 2;
    pkg.storyboards[0].audio_description.sound_effects = [123];
    pkg.storyboards[0].transition.type = 123;
    pkg.storyboards[0].transition.duration = -1;
    pkg.storyboards[0].transition.audio_bridge.duration_ms = -1;
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((item) => item.path).sort(), [
      'storyboards[0].audio_description.music_cue.intensity',
      'storyboards[0].audio_description.music_cue.mode',
      'storyboards[0].audio_description.sound_effects[0]',
      'storyboards[0].transition.audio_bridge.duration_ms',
      'storyboards[0].transition.duration',
      'storyboards[0].transition.type',
    ]);
  });

  it('旧包可省略 audio_plan 和人物新增字段', () => {
    const pkg = examplePackage();
    delete pkg.generation_profile.contract_profile;
    delete pkg.audio_plan;
    delete pkg.characters[0].appearance;
    delete pkg.characters[0].image_prompt;
    delete pkg.characters[0].negative_prompt;
    delete pkg.characters[0].voice_profile;
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, true, `旧包兼容不应报错: ${JSON.stringify(result.errors)}`);
  });

  it('旧包可携带部分 audio_plan 而不触发 complete_av_v1 严格档位', () => {
    const pkg = examplePackage();
    delete pkg.generation_profile.contract_profile;
    pkg.audio_plan = { bgm: { mode: 'per_segment', prompt: 'legacy cue' } };
    delete pkg.characters[0].appearance;
    delete pkg.characters[0].image_prompt;
    delete pkg.characters[0].negative_prompt;
    delete pkg.characters[0].voice_profile;
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, true, `部分 audio_plan 旧包不应报错: ${JSON.stringify(result.errors)}`);
  });

  it('旧包的声音与转场对象保持历史宽松兼容', () => {
    const pkg = examplePackage();
    delete pkg.generation_profile.contract_profile;
    pkg.storyboards[0].audio_description = {
      ambience: null,
      sound_effects: [123, null],
      dialogue_treatment: null,
      silence: null,
      music_cue: null,
      speech_override: null,
    };
    pkg.storyboards[0].transition = {
      duration: null,
      audio_bridge: {
        mode: null,
        duration_ms: null,
        description: null,
      },
    };
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, true, `旧包内部字段应由归一化器宽松处理: ${JSON.stringify(result.errors)}`);
  });

  it('旧包声音与转场仍校验外层必须是字符串或普通对象', () => {
    const pkg = examplePackage();
    delete pkg.generation_profile.contract_profile;
    pkg.storyboards[0].audio_description = 42;
    pkg.storyboards[0].transition = [];
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((item) => item.path).sort(), [
      'storyboards[0].audio_description',
      'storyboards[0].transition',
    ]);
  });

  it('scenes/props 必填字段违规 path 精确', () => {
    const pkg = examplePackage();
    pkg.scenes[0].state = '   ';
    pkg.props[0].image_prompt = 123;
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, false);
    const paths = result.errors.map((e) => e.path).sort();
    assert.deepEqual(paths, ['props[0].image_prompt', 'scenes[0].state']);
  });

  it('characters/scenes/props 缺省视为空数组;未知字段不报错', () => {
    const pkg = examplePackage();
    delete pkg.characters;
    delete pkg.scenes;
    delete pkg.props;
    pkg.future_field = { anything: true };
    pkg.storyboards[0].new_sub_field = 'whatever';
    const result = validatePackageStructure(pkg);
    assert.equal(result.ok, true, `不应报错: ${JSON.stringify(result.errors)}`);
  });

  it('非对象输入不抛异常且 ok=false', () => {
    for (const bad of [null, undefined, 'str', 42, [], true]) {
      const result = validatePackageStructure(bad);
      assert.equal(result.ok, false, `输入 ${JSON.stringify(bad)} 应校验失败`);
      assert.ok(result.errors.length >= 1);
      assert.equal(result.errors[0].path, '');
    }
  });

  it('storyboards 非数组 → path=storyboards', () => {
    const errors = violationErrors((pkg) => { pkg.storyboards = {}; });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'storyboards');
  });
});
