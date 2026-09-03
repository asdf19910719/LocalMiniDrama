/**
 * 单集制作包(local-mini-drama.episode-package v1.0)业务校验与确定性归一化
 *
 * 与 episodePackageSchema.js 的分工:
 * - 结构/类型校验(必填字段存在性、数组形态等)由 validatePackageStructure 负责;
 * - 本模块负责其上的跨字段业务规则(设计文档 §5.6、§12.1、§12.2):
 *   稳定键唯一性、跨引用、状态归属、镜号/时长、万能提示词草稿 @图片N 槽位校验,
 *   以及 §5.6 必填镜头字段(shot_type/camera_angle/camera_movement/composition/action、
 *   character_refs[].reference_role)的缺失拦截(§12.1"必填字段缺失"阻塞错误)。
 * - renderAction/renderDialogue/generateScriptFromStoryboards 是 §5.6.1 的确定性
 *   纯文本渲染,同一输入永远产出逐字节相同的文本(§14.1),供导入映射复用。
 *
 * 约定:
 * - 纯函数,无 IO,不依赖数据库;任何输入都不抛异常,违规以 { code, path, message } 收集返回。
 * - 前置假设:调用方已先用 validatePackageStructure 过滤结构错误;本模块对非法输入
 *   尽量防御性跳过而不是叠加重复报错。
 * - logicalSlots 返回的 character_variant 槽位 ref 是对象 { character_ref, variant_ref };
 *   scene/prop 槽位 ref 是 source_key 字符串。
 * - path 约定:
 *   - 分镜级错误默认用下标定位,如 storyboards[0].shot_type;
 *   - PACKAGE_REF_MISSING、PACKAGE_REF_DUPLICATE 与 PACKAGE_SLOT_OVERFLOW 按任务约定在 path 中携带分镜
 *     source_key,如 storyboards[sb_01].scene_ref,便于跨数组定位到具体分镜
 *     (分镜无合法 source_key 时回落到下标形式)。
 */

'use strict';

const DRAFT_REF_PATTERN_SOURCE = '@(?:图片|image)\\s*(\\d+)';

// 万能提示词草稿槽位引用:@图片N / @image N,大小写不敏感
const DRAFT_REF_PATTERN = new RegExp(DRAFT_REF_PATTERN_SOURCE, 'gi');

const REQUIRED_STORYBOARD_FIELDS = [
  { field: 'shot_type', label: '景别' },
  { field: 'camera_angle', label: '镜头角度' },
  { field: 'camera_movement', label: '运镜' },
  { field: 'composition', label: '画面构图' },
  { field: 'action', label: '动作过程' },
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function textOf(value) {
  return value === null || value === undefined ? '' : String(value);
}

// 确定性渲染段:非空(去空白后)才参与拼接
function segmentText(value) {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * 计算分镜的逻辑参考图槽位(1-based),顺序:scene_ref → character_refs(按
 * sort_order 升序,非法 sort_order 视为 +Infinity 并保持稳定排序)→ prop_refs(数组序)。
 * phase 2 的统一参考图解析器必须复用本函数,保证槽位编号全局一致。
 *
 * character_variant 槽位的 ref 为 { character_ref, variant_ref } 对象,
 * scene/prop 槽位的 ref 为 source_key 字符串。
 * @param {*} storyboard 单个分镜对象
 * @returns {Array<{index: number, type: 'scene'|'character_variant'|'prop', ref: *}>}
 */
function logicalSlots(storyboard) {
  const slots = [];
  if (!isPlainObject(storyboard)) return slots;

  if (hasText(storyboard.scene_ref)) {
    slots.push({ index: slots.length + 1, type: 'scene', ref: storyboard.scene_ref });
  }

  const refs = Array.isArray(storyboard.character_refs) ? storyboard.character_refs : [];
  const sortOrderOf = (ref) =>
    typeof ref.sort_order === 'number' && Number.isFinite(ref.sort_order) ? ref.sort_order : Number.POSITIVE_INFINITY;
  const orderedRefs = refs.filter(isPlainObject).slice().sort((a, b) => sortOrderOf(a) - sortOrderOf(b));
  for (const ref of orderedRefs) {
    slots.push({
      index: slots.length + 1,
      type: 'character_variant',
      ref: { character_ref: textOf(ref.character_ref), variant_ref: textOf(ref.variant_ref) },
    });
  }

  const propRefs = Array.isArray(storyboard.prop_refs) ? storyboard.prop_refs : [];
  for (const propRef of propRefs) {
    slots.push({ index: slots.length + 1, type: 'prop', ref: textOf(propRef) });
  }

  return slots;
}

/**
 * 解析万能提示词草稿中的槽位引用。
 * @param {*} text 草稿文本
 * @param {*} slotCount 该分镜的逻辑槽位总数
 * @returns {{ refs: number[], overflow: number[] }} refs 按出现顺序(含重复);
 *          overflow 为其中 N > slotCount 的引用(按出现顺序,含重复)。
 */
function validateUniversalDraftRefs(text, slotCount) {
  const refs = [];
  const overflow = [];
  if (typeof text !== 'string') return { refs, overflow };
  const limit = typeof slotCount === 'number' && Number.isFinite(slotCount) ? slotCount : 0;
  const pattern = new RegExp(DRAFT_REF_PATTERN_SOURCE, 'gi');
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const slot = Number.parseInt(match[1], 10);
    refs.push(slot);
    if (slot > limit) overflow.push(slot);
  }
  return { refs, overflow };
}

/**
 * §5.6.1 action 的确定性纯文本渲染:
 * - string 原样返回;
 * - {start, progression, end} → ['开始：…', '推进：…', '结束：…'] 过滤空段后以 '\n' 连接;
 * - null/undefined/其他类型 → ''。
 */
function renderAction(action) {
  if (typeof action === 'string') return action;
  if (!isPlainObject(action)) return '';
  const lines = [];
  for (const [label, key] of [
    ['开始：', 'start'],
    ['推进：', 'progression'],
    ['结束：', 'end'],
  ]) {
    const value = segmentText(action[key]);
    if (value.trim() !== '') lines.push(label + value);
  }
  return lines.join('\n');
}

/**
 * §5.6.1 dialogue 的确定性纯文本渲染:
 * - 数组逐行渲染 '『'+speaker+'』'+(performance ? '（'+performance+'）' : '')+'：'+line,
 *   speaker 缺省用『旁白』;
 * - string 原样返回;null/undefined/其他类型 → ''。
 */
function renderDialogue(dialogue) {
  if (typeof dialogue === 'string') return dialogue;
  if (!Array.isArray(dialogue)) return '';
  const lines = [];
  for (const item of dialogue) {
    if (!isPlainObject(item)) continue;
    const speaker = hasText(item.speaker) ? item.speaker : '旁白';
    const performance = hasText(item.performance) ? '（' + item.performance + '）' : '';
    lines.push('『' + speaker + '』' + performance + '：' + segmentText(item.line));
  }
  return lines.join('\n');
}

/**
 * episode.script 缺失时按分镜确定性拼接剧本(不调用 AI):
 * 逐镜 '【镜N·场景名】title\n动作：…\n对白：…\n旁白：…',空段跳行,两镜间空行。
 * 镜号 N 取 storyboard_number(正整数),否则用数组序号兜底;
 * 场景名优先 storyboard.scene_name,否则回落 storyboard.scene_ref。
 */
function generateScriptFromStoryboards(storyboards) {
  if (!Array.isArray(storyboards)) return '';
  const blocks = [];
  storyboards.forEach((storyboard, arrayIndex) => {
    if (!isPlainObject(storyboard)) return;
    const number =
      Number.isInteger(storyboard.storyboard_number) && storyboard.storyboard_number > 0
        ? storyboard.storyboard_number
        : arrayIndex + 1;
    const sceneName = hasText(storyboard.scene_name)
      ? storyboard.scene_name
      : hasText(storyboard.scene_ref)
        ? storyboard.scene_ref
        : '';
    const lines = [`【镜${number}·${sceneName}】${textOf(storyboard.title)}`];
    const action = renderAction(storyboard.action);
    if (action !== '') lines.push('动作：' + action);
    const dialogue = renderDialogue(storyboard.dialogue);
    if (dialogue !== '') lines.push('对白：' + dialogue);
    if (hasText(storyboard.narration)) lines.push('旁白：' + storyboard.narration);
    blocks.push(lines.join('\n'));
  });
  return blocks.join('\n\n');
}

// 在指定作用域内收集 source_key 重复(仅比较非空字符串键;键缺失属结构错误,由结构校验负责)
function collectKeyDuplicates(list, pathOf) {
  const errors = [];
  if (!Array.isArray(list)) return errors;
  const seen = new Map();
  list.forEach((item, index) => {
    const key = isPlainObject(item) ? item.source_key : undefined;
    if (!hasText(key)) return;
    if (seen.has(key)) {
      errors.push({
        code: 'PACKAGE_KEY_DUPLICATE',
        path: pathOf(index),
        message: `source_key "${key}" 在 ${pathOf(index).split('.')[0]} 内重复(首次出现于 ${seen.get(key)})`,
      });
      return;
    }
    seen.set(key, pathOf(index));
  });
  return errors;
}

// 分镜引用类错误的 path 携带分镜 source_key(无合法 source_key 时回落下标)
function storyboardRefPath(storyboard, index, suffix) {
  const prefix = hasText(storyboard.source_key) ? `storyboards[${storyboard.source_key}]` : `storyboards[${index}]`;
  return suffix ? `${prefix}.${suffix}` : prefix;
}

function findCharacterEntry(pkg, characterRef) {
  if (!hasText(characterRef) || !Array.isArray(pkg.characters)) return undefined;
  return pkg.characters.find((c) => isPlainObject(c) && c.source_key === characterRef);
}

function characterOwnsVariant(characterEntry, variantRef) {
  if (!isPlainObject(characterEntry) || !Array.isArray(characterEntry.variants)) return false;
  return characterEntry.variants.some((v) => isPlainObject(v) && v.source_key === variantRef);
}

// 草稿字段是否提供(字符串或对象均可,空白字符串视为缺失)
function draftProvided(value) {
  return isPlainObject(value) || hasText(value);
}

/**
 * 业务校验(设计文档 §5.6、§12.1、§12.2)。任何输入都不抛异常。
 * @param {*} pkg 待校验制作包(通常为 JSON.parse 结果,应先通过结构校验)
 * @returns {{ errors: Array<{code, path, message}>, warnings: Array<{code, path, message}> }}
 */
function validateBusinessRules(pkg) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(pkg)) return { errors, warnings };

  // —— §12.2 可选剧本缺失:警告,导入时从分镜确定性生成 ——
  const script = isPlainObject(pkg.episode) ? pkg.episode.script : undefined;
  if (!hasText(script)) {
    warnings.push({
      code: 'SCRIPT_MISSING',
      path: 'episode.script',
      message: 'episode.script 缺失或为空,导入时将从分镜确定性生成剧本',
    });
  }

  const characters = Array.isArray(pkg.characters) ? pkg.characters : [];
  const scenes = Array.isArray(pkg.scenes) ? pkg.scenes : [];
  const props = Array.isArray(pkg.props) ? pkg.props : [];
  const storyboards = Array.isArray(pkg.storyboards) ? pkg.storyboards : [];

  // —— §12.1 稳定键重复 ——
  errors.push(...collectKeyDuplicates(characters, (i) => `characters[${i}].source_key`));
  characters.forEach((character, ci) => {
    if (!isPlainObject(character)) return;
    errors.push(
      ...collectKeyDuplicates(
        Array.isArray(character.variants) ? character.variants : [],
        (vi) => `characters[${ci}].variants[${vi}].source_key`
      )
    );
  });
  errors.push(...collectKeyDuplicates(scenes, (i) => `scenes[${i}].source_key`));
  errors.push(...collectKeyDuplicates(props, (i) => `props[${i}].source_key`));
  errors.push(...collectKeyDuplicates(storyboards, (i) => `storyboards[${i}].source_key`));

  // —— 分镜逐条校验 ——
  const seenStoryboardNumbers = new Set();
  storyboards.forEach((storyboard, index) => {
    if (!isPlainObject(storyboard)) return;
    const key = hasText(storyboard.source_key) ? storyboard.source_key : `#${index + 1}`;
    const indexPath = (suffix) => `storyboards[${index}]${suffix ? '.' + suffix : ''}`;
    const refPath = (suffix) => storyboardRefPath(storyboard, index, suffix);

    // §12.1 必填镜头字段缺失(结构校验不含这五项 + reference_role,在此闭环)
    for (const { field, label } of REQUIRED_STORYBOARD_FIELDS) {
      const value = storyboard[field];
      const provided = field === 'action' ? hasText(value) || isPlainObject(value) : hasText(value);
      if (!provided) {
        errors.push({
          code: 'PACKAGE_REQUIRED_FIELD_MISSING',
          path: indexPath(field),
          message: `分镜 ${key} 缺少必填字段 ${field}(${label})`,
        });
      }
    }

    // §12.1 时长非法(≤0 或非有限数)
    const duration = storyboard.duration_seconds;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
      errors.push({
        code: 'PACKAGE_DURATION_INVALID',
        path: indexPath('duration_seconds'),
        message: `分镜 ${key} 的 duration_seconds 必须为正数,当前为 ${textOf(duration) || '缺失'}`,
      });
    }

    // §12.1 镜号重复
    if (Number.isInteger(storyboard.storyboard_number)) {
      if (seenStoryboardNumbers.has(storyboard.storyboard_number)) {
        errors.push({
          code: 'PACKAGE_NUMBER_DUPLICATE',
          path: indexPath('storyboard_number'),
          message: `镜号 ${storyboard.storyboard_number} 重复,分镜 ${key} 与先前分镜冲突`,
        });
      } else {
        seenStoryboardNumbers.add(storyboard.storyboard_number);
      }
    }

    // §12.1 跨引用:scene_ref
    if (hasText(storyboard.scene_ref) && !scenes.some((s) => isPlainObject(s) && s.source_key === storyboard.scene_ref)) {
      errors.push({
        code: 'PACKAGE_REF_MISSING',
        path: refPath('scene_ref'),
        message: `分镜 ${key} 的 scene_ref 引用的场景 "${storyboard.scene_ref}" 不存在`,
      });
    }

    // §12.1 跨引用:character_refs / 状态归属 / reference_role 必填
    const characterRefs = Array.isArray(storyboard.character_refs) ? storyboard.character_refs : [];
    characterRefs.forEach((ref, refIndex) => {
      if (!isPlainObject(ref)) return;
      const characterEntry = findCharacterEntry(pkg, ref.character_ref);
      if (!characterEntry) {
        errors.push({
          code: 'PACKAGE_REF_MISSING',
          path: refPath(`character_refs[${refIndex}].character_ref`),
          message: `分镜 ${key} 的 character_refs[${refIndex}].character_ref 引用的人物 "${textOf(ref.character_ref)}" 不存在`,
        });
      } else if (hasText(ref.variant_ref) && !characterOwnsVariant(characterEntry, ref.variant_ref)) {
        errors.push({
          code: 'VARIANT_CHARACTER_MISMATCH',
          path: refPath(`character_refs[${refIndex}].variant_ref`),
          message: `分镜 ${key} 的 character_refs[${refIndex}].variant_ref "${ref.variant_ref}" 不属于人物 "${ref.character_ref}"`,
        });
      }
      if (!hasText(ref.reference_role)) {
        errors.push({
          code: 'PACKAGE_REQUIRED_FIELD_MISSING',
          path: indexPath(`character_refs[${refIndex}].reference_role`),
          message: `分镜 ${key} 的 character_refs[${refIndex}] 缺少必填字段 reference_role(用途角色)`,
        });
      }
    });

    // §12.1 同分镜内重复 (character_ref, variant_ref) 对:跨分镜重复同一资产合法,
    // 但同一分镜内重复会使 storyboards_x_variants 唯一索引裸错(或静默去重导致槽位漂移)。
    const seenVariantPairs = new Set();
    characterRefs.forEach((ref, refIndex) => {
      if (!isPlainObject(ref)) return;
      const pairKey = `${textOf(ref.character_ref)}\u0000${textOf(ref.variant_ref)}`;
      if (seenVariantPairs.has(pairKey)) {
        errors.push({
          code: 'PACKAGE_REF_DUPLICATE',
          path: refPath(`character_refs[${refIndex}]`),
          message: `分镜 ${key} 的 character_refs[${refIndex}] 重复引用人物状态 (${textOf(ref.character_ref)}, ${textOf(ref.variant_ref)}),同一分镜内重复引用会导致参考图槽位错位`,
        });
        return;
      }
      seenVariantPairs.add(pairKey);
    });

    // §12.1 跨引用:prop_refs
    const propRefs = Array.isArray(storyboard.prop_refs) ? storyboard.prop_refs : [];
    propRefs.forEach((propRef, propIndex) => {
      if (!hasText(propRef)) return;
      if (!props.some((p) => isPlainObject(p) && p.source_key === propRef)) {
        errors.push({
          code: 'PACKAGE_REF_MISSING',
          path: refPath(`prop_refs[${propIndex}]`),
          message: `分镜 ${key} 的 prop_refs[${propIndex}] 引用的道具 "${propRef}" 不存在`,
        });
      }
    });

    // §12.1 同分镜内重复 prop_ref(同上,跨分镜重复同一道具仍合法)
    const seenPropRefs = new Set();
    propRefs.forEach((propRef, propIndex) => {
      if (!hasText(propRef)) return;
      if (seenPropRefs.has(propRef)) {
        errors.push({
          code: 'PACKAGE_REF_DUPLICATE',
          path: refPath(`prop_refs[${propIndex}]`),
          message: `分镜 ${key} 的 prop_refs[${propIndex}] 重复引用道具 "${propRef}",同一分镜内重复引用会导致参考图槽位错位`,
        });
        return;
      }
      seenPropRefs.add(propRef);
    });

    // §12.2 可选声音/转场/万能提示词草稿缺失
    if (!draftProvided(storyboard.audio_description)) {
      warnings.push({
        code: 'AUDIO_MISSING',
        path: indexPath('audio_description'),
        message: `分镜 ${key} 缺少 audio_description(环境音/动作音/人声)`,
      });
    }
    if (!draftProvided(storyboard.transition)) {
      warnings.push({
        code: 'TRANSITION_MISSING',
        path: indexPath('transition'),
        message: `分镜 ${key} 缺少 transition(与前后镜头的衔接方式)`,
      });
    }
    if (!hasText(storyboard.universal_segment_text)) {
      warnings.push({
        code: 'UNIVERSAL_DRAFT_MISSING',
        path: indexPath('universal_segment_text'),
        message: `分镜 ${key} 未提供 universal_segment_text 万能提示词草稿`,
      });
      return;
    }

    // §12.1/§12.2 万能提示词草稿槽位越界与缺口
    const slots = logicalSlots(storyboard);
    const total = slots.length;
    const { refs, overflow } = validateUniversalDraftRefs(storyboard.universal_segment_text, total);
    if (overflow.length > 0) {
      const distinct = [...new Set(overflow)];
      errors.push({
        code: 'PACKAGE_SLOT_OVERFLOW',
        path: refPath('universal_segment_text'),
        message: `分镜 ${key} 的万能提示词草稿引用了 @图片${distinct.join('、@图片')},但该分镜只有 ${total} 个参考图槽位`,
      });
    }
    const referenced = new Set(refs.filter((n) => n >= 1 && n <= total));
    const gaps = [];
    for (let slot = 1; slot <= total; slot += 1) {
      if (!referenced.has(slot)) gaps.push(slot);
    }
    if (gaps.length > 0) {
      warnings.push({
        code: 'UNIVERSAL_DRAFT_SLOT_GAP',
        path: indexPath('universal_segment_text'),
        message: `分镜 ${key} 的万能提示词草稿未引用槽位 ${gaps.join('、')}`,
      });
    }
  });

  return { errors, warnings };
}

module.exports = {
  logicalSlots,
  validateBusinessRules,
  renderAction,
  renderDialogue,
  generateScriptFromStoryboards,
  validateUniversalDraftRefs,
};
