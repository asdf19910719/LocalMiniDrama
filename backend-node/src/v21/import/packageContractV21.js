'use strict';

const SCHEMA_NAME = 'local-mini-drama.episode-package';
const SCHEMA_VERSION = '2.1';
const SOURCE_KEY_RE = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

/**
 * episode-package@2.1 / external-ai-result@2.1 合同校验（V2.1 唯一协议）。
 * 错误码固定：PACKAGE_SCHEMA_UNSUPPORTED / PACKAGE_VERSION_UNSUPPORTED / PACKAGE_SCHEMA_INVALID。
 * 字符串协议识别（数值 2.1 与其他版本一律拒绝，见 test-version-contract 契约）。
 */
function errorOf(code, path, message) {
  return { code, path, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function checkString(errors, path, value, { minLength = 1 } = {}) {
  if (!isString(value) || value.length < minLength) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', path, `应为长度≥${minLength}的字符串`));
    return false;
  }
  return true;
}

function checkNumber(errors, path, value, { exclusiveMinimum = null, minimum = null } = {}) {
  if (!isNumber(value)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', path, '应为数字'));
    return false;
  }
  if (exclusiveMinimum !== null && value <= exclusiveMinimum) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', path, `应大于 ${exclusiveMinimum}`));
    return false;
  }
  if (minimum !== null && value < minimum) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', path, `应不小于 ${minimum}`));
    return false;
  }
  return true;
}

function checkUnknownFields(errors, path, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      errors.push(errorOf('PACKAGE_SCHEMA_INVALID', path ? `${path}.${key}` : key, '未知字段（协议扩展只能放入 extensions）'));
    }
  }
}

function checkSourceKey(errors, path, value) {
  if (!isString(value) || !SOURCE_KEY_RE.test(value)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', path, 'source_key 格式不合法'));
    return false;
  }
  return true;
}

function validateCharacter(errors, prefix, character, index) {
  const p = `${prefix}[${index}]`;
  if (!isObject(character)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    return;
  }
  checkUnknownFields(errors, p, character, [
    'source_key', 'name', 'role', 'description', 'personality', 'appearance',
    'base_image_prompt', 'negative_prompt', 'voice_profile', 'states',
  ]);
  checkSourceKey(errors, `${p}.source_key`, character.source_key);
  checkString(errors, `${p}.name`, character.name);
  if (!['main', 'supporting', 'minor'].includes(character.role)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.role`, 'role 必须为 main/supporting/minor'));
  }
  checkString(errors, `${p}.description`, character.description);
  checkString(errors, `${p}.personality`, character.personality);
  checkString(errors, `${p}.appearance`, character.appearance);
  if (!Array.isArray(character.states) || character.states.length === 0) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.states`, '至少需要一个人物状态'));
  } else {
    character.states.forEach((state, si) => validateCharacterState(errors, `${p}.states`, state, si));
  }
}

function validateCharacterState(errors, prefix, state, index) {
  const p = `${prefix}[${index}]`;
  if (!isObject(state)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    return;
  }
  checkUnknownFields(errors, p, state, [
    'source_key', 'name', 'description', 'appearance', 'base_image_prompt', 'negative_prompt', 'is_default',
  ]);
  checkSourceKey(errors, `${p}.source_key`, state.source_key);
  checkString(errors, `${p}.name`, state.name);
  checkString(errors, `${p}.description`, state.description);
  checkString(errors, `${p}.appearance`, state.appearance);
  if (typeof state.is_default !== 'boolean') {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.is_default`, '应为布尔值'));
  }
}

function validateSceneAsset(errors, prefix, scene, index) {
  const p = `${prefix}[${index}]`;
  if (!isObject(scene)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    return;
  }
  checkUnknownFields(errors, p, scene, [
    'source_key', 'name', 'state', 'description', 'atmosphere', 'base_image_prompt', 'negative_prompt',
  ]);
  checkSourceKey(errors, `${p}.source_key`, scene.source_key);
  checkString(errors, `${p}.name`, scene.name);
  checkString(errors, `${p}.state`, scene.state);
  checkString(errors, `${p}.description`, scene.description);
  checkString(errors, `${p}.atmosphere`, scene.atmosphere);
}

function validateProp(errors, prefix, prop, index) {
  const p = `${prefix}[${index}]`;
  if (!isObject(prop)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    return;
  }
  checkUnknownFields(errors, p, prop, [
    'source_key', 'name', 'type', 'description', 'base_image_prompt', 'negative_prompt',
  ]);
  checkSourceKey(errors, `${p}.source_key`, prop.source_key);
  checkString(errors, `${p}.name`, prop.name);
  checkString(errors, `${p}.type`, prop.type);
  checkString(errors, `${p}.description`, prop.description);
}

function validateSpeech(errors, p, speech) {
  if (!isObject(speech)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    return;
  }
  checkUnknownFields(errors, p, speech, ['speaker_ref', 'start_seconds', 'end_seconds', 'text', 'performance']);
  if (speech.speaker_ref !== undefined) checkSourceKey(errors, `${p}.speaker_ref`, speech.speaker_ref);
  checkNumber(errors, `${p}.start_seconds`, speech.start_seconds, { minimum: 0 });
  checkNumber(errors, `${p}.end_seconds`, speech.end_seconds, { exclusiveMinimum: 0 });
  checkString(errors, `${p}.text`, speech.text);
}

function validateSegment(errors, prefix, segment, index) {
  const p = `${prefix}[${index}]`;
  if (!isObject(segment)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    return;
  }
  checkUnknownFields(errors, p, segment, [
    'start_seconds', 'end_seconds', 'action', 'camera', 'dialogue',
    'scene_asset_refs', 'character_state_refs', 'prop_refs',
  ]);
  checkNumber(errors, `${p}.start_seconds`, segment.start_seconds, { minimum: 0 });
  checkNumber(errors, `${p}.end_seconds`, segment.end_seconds, { exclusiveMinimum: 0 });
  checkString(errors, `${p}.action`, segment.action);
  if (segment.dialogue !== undefined) {
    if (!Array.isArray(segment.dialogue)) {
      errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.dialogue`, '应为数组'));
    } else {
      segment.dialogue.forEach((s, i) => validateSpeech(errors, `${p}.dialogue[${i}]`, s));
    }
  }
  if (!Array.isArray(segment.scene_asset_refs) || segment.scene_asset_refs.length === 0) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.scene_asset_refs`, '至少一个场景资产引用'));
  }
  for (const key of ['scene_asset_refs', 'character_state_refs', 'prop_refs']) {
    if (!Array.isArray(segment[key])) {
      errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.${key}`, '应为数组'));
    } else {
      const seen = new Set();
      for (const ref of segment[key]) {
        if (seen.has(ref)) {
          errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.${key}`, `引用 "${ref}" 在同一时段内重复`));
        }
        seen.add(ref);
      }
    }
  }
}

function validateShot(errors, prefix, shot, index) {
  const p = `${prefix}[${index}]`;
  if (!isObject(shot)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    return;
  }
  checkUnknownFields(errors, p, shot, [
    'source_key', 'shot_number', 'story_scene_refs', 'planned_duration_seconds', 'story_intent',
    'base_video_prompt', 'visual', 'timed_segments', 'continuity', 'audio', 'extensions',
  ]);
  checkSourceKey(errors, `${p}.source_key`, shot.source_key);
  checkNumber(errors, `${p}.shot_number`, shot.shot_number, { minimum: 1 });
  if (!Array.isArray(shot.story_scene_refs) || shot.story_scene_refs.length === 0) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.story_scene_refs`, '至少一个场次引用'));
  }
  checkNumber(errors, `${p}.planned_duration_seconds`, shot.planned_duration_seconds, { exclusiveMinimum: 0 });
  checkString(errors, `${p}.story_intent`, shot.story_intent);
  if (shot.base_video_prompt !== undefined) checkString(errors, `${p}.base_video_prompt`, shot.base_video_prompt);
  if (!isObject(shot.visual)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.visual`, '应为对象'));
  } else {
    checkUnknownFields(errors, `${p}.visual`, shot.visual, ['shot_size', 'camera_angle', 'camera_movement', 'composition', 'lighting']);
    for (const key of ['shot_size', 'camera_angle', 'camera_movement', 'composition', 'lighting']) {
      checkString(errors, `${p}.visual.${key}`, shot.visual[key]);
    }
  }
  if (!Array.isArray(shot.timed_segments) || shot.timed_segments.length === 0) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.timed_segments`, '至少一个时段（单时段合法）'));
  } else {
    shot.timed_segments.forEach((s, i) => validateSegment(errors, `${p}.timed_segments`, s, i));
  }
  if (!isObject(shot.continuity)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.continuity`, '应为对象'));
  } else {
    checkUnknownFields(errors, `${p}.continuity`, shot.continuity, ['entry', 'exit', 'axis']);
    if (!isObject(shot.continuity.entry)) errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.continuity.entry`, '应为对象'));
    if (!isObject(shot.continuity.exit)) errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.continuity.exit`, '应为对象'));
  }
  if (!isObject(shot.audio)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.audio`, '应为对象'));
  } else {
    checkUnknownFields(errors, `${p}.audio`, shot.audio, ['dialogue', 'narration', 'ambience', 'sound_effects', 'music_intent']);
    for (const key of ['dialogue', 'narration', 'ambience', 'sound_effects']) {
      if (!Array.isArray(shot.audio[key])) {
        errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.audio.${key}`, '应为数组'));
      }
    }
  }
}

/** 结构校验（schema 字段级）；返回 { ok, errors } */
function validatePackageV21(value) {
  const errors = [];
  if (!isObject(value)) {
    return { ok: false, errors: [errorOf('PACKAGE_SCHEMA_INVALID', '', '制作包必须是 JSON 对象')] };
  }
  if (value.schema !== SCHEMA_NAME) {
    errors.push(
      errorOf(
        'PACKAGE_SCHEMA_UNSUPPORTED',
        'schema',
        `未知协议 "${value.schema}"，当前仅支持 ${SCHEMA_NAME}`
      )
    );
    return { ok: false, errors };
  }
  if (typeof value.version !== 'string') {
    errors.push(
      errorOf('PACKAGE_SCHEMA_INVALID', 'version', `version 必须为字符串 "${SCHEMA_VERSION}"（收到 ${typeof value.version}）`)
    );
  } else if (value.version !== SCHEMA_VERSION) {
    errors.push(errorOf('PACKAGE_VERSION_UNSUPPORTED', 'version', `版本 "${value.version}" 不受支持，仅支持 "${SCHEMA_VERSION}"`));
  }
  checkUnknownFields(errors, '', value, [
    'schema', 'version', 'episode', 'assets', 'story_scenes', 'shot_packages', 'audio_plan', 'extensions',
  ]);

  // episode
  if (!isObject(value.episode)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', 'episode', '应为对象'));
  } else {
    checkUnknownFields(errors, 'episode', value.episode, [
      'episode_number', 'title', 'summary', 'script', 'duration_target_seconds', 'notes',
    ]);
    checkNumber(errors, 'episode.episode_number', value.episode.episode_number, { minimum: 1 });
    checkString(errors, 'episode.title', value.episode.title);
    checkString(errors, 'episode.summary', value.episode.summary);
    checkString(errors, 'episode.script', value.episode.script);
    checkNumber(errors, 'episode.duration_target_seconds', value.episode.duration_target_seconds, { exclusiveMinimum: 0 });
  }

  // assets
  if (!isObject(value.assets)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', 'assets', '应为对象'));
  } else {
    checkUnknownFields(errors, 'assets', value.assets, ['characters', 'scene_assets', 'props']);
    for (const key of ['characters', 'scene_assets', 'props']) {
      if (!Array.isArray(value.assets[key])) {
        errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `assets.${key}`, '应为数组'));
      }
    }
    if (Array.isArray(value.assets.characters)) {
      value.assets.characters.forEach((c, i) => validateCharacter(errors, 'assets.characters', c, i));
    }
    if (Array.isArray(value.assets.scene_assets)) {
      value.assets.scene_assets.forEach((s, i) => validateSceneAsset(errors, 'assets.scene_assets', s, i));
    }
    if (Array.isArray(value.assets.props)) {
      value.assets.props.forEach((p2, i) => validateProp(errors, 'assets.props', p2, i));
    }
  }

  // story_scenes / shot_packages
  if (!Array.isArray(value.story_scenes) || value.story_scenes.length === 0) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', 'story_scenes', '必须包含至少一个场次'));
  } else {
    value.story_scenes.forEach((scene, i) => {
      const p = `story_scenes[${i}]`;
      if (!isObject(scene)) {
        errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
        return;
      }
      checkUnknownFields(errors, p, scene, [
        'source_key', 'scene_number', 'heading', 'location_scene_ref', 'summary', 'look_override',
      ]);
      checkSourceKey(errors, `${p}.source_key`, scene.source_key);
      checkNumber(errors, `${p}.scene_number`, scene.scene_number, { minimum: 1 });
      checkString(errors, `${p}.heading`, scene.heading);
      checkSourceKey(errors, `${p}.location_scene_ref`, scene.location_scene_ref);
      checkString(errors, `${p}.summary`, scene.summary);
    });
  }
  if (!Array.isArray(value.shot_packages) || value.shot_packages.length === 0) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', 'shot_packages', '必须包含至少一个分镜包'));
  } else {
    value.shot_packages.forEach((shot, i) => validateShot(errors, 'shot_packages', shot, i));
  }

  // 可选 audio_plan / extensions
  if (value.audio_plan !== undefined) {
    const p = 'audio_plan';
    if (!isObject(value.audio_plan)) {
      errors.push(errorOf('PACKAGE_SCHEMA_INVALID', p, '应为对象'));
    } else {
      checkUnknownFields(errors, p, value.audio_plan, ['bgm_mode', 'dialogue_owner_default', 'narration_owner_default']);
      if (!['none', 'episode_track', 'per_segment'].includes(value.audio_plan.bgm_mode)) {
        errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.bgm_mode`, 'bgm_mode 非法'));
      }
      for (const key of ['dialogue_owner_default', 'narration_owner_default']) {
        if (!['h3_native', 'post_tts', 'source_media', 'none'].includes(value.audio_plan[key])) {
          errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.${key}`, 'owner 非法'));
        }
      }
    }
  }
  if (value.extensions !== undefined && !isObject(value.extensions)) {
    errors.push(errorOf('PACKAGE_SCHEMA_INVALID', 'extensions', '应为对象'));
  }

  if (errors.length > 0) return { ok: false, errors };
  const business = validateBusinessV21(value);
  if (!business.ok) return business;
  const refs = validateReferencesV21(value);
  return { ok: refs.length === 0, errors: refs };
}

/** 业务校验（schema 通过后）：键唯一、引用可解析、时码闭合、台词在时段内 */
function validateBusinessV21(pkg) {
  const errors = [];
  const seenKeys = new Set();
  const registerKey = (key, path) => {
    if (seenKeys.has(key)) {
      errors.push(errorOf('PACKAGE_SCHEMA_INVALID', path, `source_key "${key}" 重复`));
    }
    seenKeys.add(key);
  };
  (pkg.assets.characters || []).forEach((c, i) => {
    registerKey(c.source_key, `assets.characters[${i}].source_key`);
    (c.states || []).forEach((s, j) => registerKey(s.source_key, `assets.characters[${i}].states[${j}].source_key`));
  });
  (pkg.assets.scene_assets || []).forEach((s, i) => registerKey(s.source_key, `assets.scene_assets[${i}].source_key`));
  (pkg.assets.props || []).forEach((p2, i) => registerKey(p2.source_key, `assets.props[${i}].source_key`));

  const sceneKeys = new Set((pkg.story_scenes || []).map((s) => s.source_key));
  const sceneNumbers = new Set();
  (pkg.story_scenes || []).forEach((s, i) => {
    if (sceneNumbers.has(s.scene_number)) {
      errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `story_scenes[${i}].scene_number`, '场次序号重复'));
    }
    sceneNumbers.add(s.scene_number);
    if (!seenKeys.has(s.location_scene_ref) || !hasSceneAsset(pkg, s.location_scene_ref)) {
      errors.push(errorOf('REFERENCE_UNRESOLVED', `story_scenes[${i}].location_scene_ref`, `场景引用 "${s.location_scene_ref}" 不存在`));
    }
  });

  const shotNumbers = new Set();
  (pkg.shot_packages || []).forEach((shot, i) => {
    const p = `shot_packages[${i}]`;
    if (shotNumbers.has(shot.shot_number)) {
      errors.push(errorOf('PACKAGE_SCHEMA_INVALID', `${p}.shot_number`, '镜号重复'));
    }
    shotNumbers.add(shot.shot_number);
    for (const ref of shot.story_scene_refs || []) {
      if (!sceneKeys.has(ref)) {
        errors.push(errorOf('REFERENCE_UNRESOLVED', `${p}.story_scene_refs`, `场次引用 "${ref}" 不存在`));
      }
    }
    validateClosure(errors, p, shot);
  });
  return { ok: errors.length === 0, errors };
}

function hasSceneAsset(pkg, key) {
  return (pkg.assets.scene_assets || []).some((s) => s.source_key === key);
}

function collectCharacterStateKeys(pkg) {
  const keys = new Set();
  for (const c of pkg.assets.characters || []) {
    for (const s of c.states || []) keys.add(s.source_key);
  }
  return keys;
}

function validateClosure(errors, p, shot) {
  const segments = shot.timed_segments || [];
  if (segments.length === 0) return;
  const stateKeys = null; // 引用解析在调用方集合上完成
  void stateKeys;
  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg.start_seconds !== cursor) {
      errors.push(
        errorOf('SEGMENT_CLOSURE_INVALID', `${p}.timed_segments[${i}].start_seconds`, `时码不连续：期望 ${cursor}，实际 ${seg.start_seconds}`)
      );
      return;
    }
    if (seg.end_seconds <= seg.start_seconds) {
      errors.push(errorOf('SEGMENT_CLOSURE_INVALID', `${p}.timed_segments[${i}]`, '时段结束必须大于开始'));
      return;
    }
    for (let d = 0; d < (seg.dialogue || []).length; d += 1) {
      const line = seg.dialogue[d];
      if (line.start_seconds < seg.start_seconds || line.end_seconds > seg.end_seconds) {
        errors.push(
          errorOf('DIALOGUE_OUT_OF_SEGMENT', `${p}.timed_segments[${i}].dialogue[${d}]`, '台词时间必须位于所属时段内')
        );
      }
    }
    cursor = seg.end_seconds;
  }
  if (cursor !== shot.planned_duration_seconds) {
    errors.push(
      errorOf('SEGMENT_CLOSURE_INVALID', `${p}.planned_duration_seconds`, `时段总长 ${cursor} 未闭合到计划时长 ${shot.planned_duration_seconds}`)
    );
  }
}

/** 引用解析（需要完整包上下文）：返回引用错误列表 */
function validateReferencesV21(pkg) {
  const errors = [];
  const characterKeys = new Set((pkg.assets.characters || []).map((c) => c.source_key));
  const stateKeys = collectCharacterStateKeys(pkg);
  const sceneAssetKeys = new Set((pkg.assets.scene_assets || []).map((s) => s.source_key));
  const propKeys = new Set((pkg.assets.props || []).map((p2) => p2.source_key));
  const checkRef = (key, collection, path, label) => {
    if (!collection.has(key)) {
      errors.push(errorOf('REFERENCE_UNRESOLVED', path, `${label}引用 "${key}" 不存在`));
    }
  };
  (pkg.shot_packages || []).forEach((shot, i) => {
    const p = `shot_packages[${i}]`;
    (shot.timed_segments || []).forEach((seg, j) => {
      const sp = `${p}.timed_segments[${j}]`;
      for (const ref of seg.scene_asset_refs || []) checkRef(ref, sceneAssetKeys, `${sp}.scene_asset_refs`, '场景资产');
      for (const ref of seg.character_state_refs || []) {
        if (!characterKeys.has(ref) && !stateKeys.has(ref)) {
          errors.push(errorOf('REFERENCE_UNRESOLVED', `${sp}.character_state_refs`, `人物/状态引用 "${ref}" 不存在`));
        }
      }
      for (const ref of seg.prop_refs || []) checkRef(ref, propKeys, `${sp}.prop_refs`, '道具');
      for (const line of seg.dialogue || []) {
        if (line.speaker_ref !== undefined) checkRef(line.speaker_ref, characterKeys, `${sp}.dialogue`, '说话人');
      }
    });
  });
  return errors;
}

/**
 * 完整校验：结构 + 业务 + 引用。
 */
function validateFullV21(pkg) {
  const structural = validatePackageV21(pkg);
  if (!structural.ok) return structural;
  const refErrors = validateReferencesV21(pkg);
  return { ok: refErrors.length === 0, errors: refErrors };
}

module.exports = {
  SCHEMA_NAME,
  SCHEMA_VERSION,
  validatePackageV21,
  validateReferencesV21,
  validateFullV21,
};
