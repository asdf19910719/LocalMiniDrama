'use strict';

const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { createStyleRegistryService } = require('./styleRegistryService');

const TASK_SCHEMA = 'local-mini-drama.external-ai-task';
const TASK_VERSION = '2';

function serviceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = canonicalize(value[key]);
    return out;
  }, {});
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function cleanText(value) {
  return value == null ? '' : String(value).trim();
}

function safeFilename(value) {
  return cleanText(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '') || '未命名项目';
}

function getDrama(db, dramaId) {
  const drama = db.prepare('SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(dramaId));
  if (!drama) throw serviceError('DRAMA_NOT_FOUND', '项目不存在');
  return drama;
}

function resolveTarget(db, dramaId, options = {}) {
  const rawId = options.targetEpisodeId;
  if (rawId !== undefined && rawId !== null && String(rawId).trim() !== '') {
    const episode = db.prepare(
      'SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL'
    ).get(Number(rawId), Number(dramaId));
    if (!episode) throw serviceError('TARGET_EPISODE_INVALID', '目标剧集不属于当前项目');
    return { episode, episodeNumber: Number(episode.episode_number) };
  }
  const requested = Number(options.targetEpisodeNumber);
  if (Number.isInteger(requested) && requested > 0) return { episode: null, episodeNumber: requested };
  const max = db.prepare(
    'SELECT MAX(episode_number) AS value FROM episodes WHERE drama_id = ? AND deleted_at IS NULL'
  ).get(Number(dramaId));
  return { episode: null, episodeNumber: Math.max(1, Number(max?.value || 0) + 1) };
}

function nextAvailableKey(db, table, scopeSql, scopeParams, prefix, id) {
  let candidate = `${prefix}_${id}`;
  let suffix = 2;
  while (db.prepare(`SELECT 1 FROM ${table} WHERE ${scopeSql} AND source_key = ? LIMIT 1`).get(...scopeParams, candidate)) {
    candidate = `${prefix}_${id}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function ensureStableAssetKeys(db, dramaId) {
  const now = new Date().toISOString();
  const assign = db.transaction(() => {
    const groups = [
      { table: 'characters', prefix: 'char', scopeSql: 'drama_id = ?', scopeParams: [Number(dramaId)] },
      { table: 'scenes', prefix: 'scene', scopeSql: 'drama_id = ?', scopeParams: [Number(dramaId)] },
      { table: 'props', prefix: 'prop', scopeSql: 'drama_id = ?', scopeParams: [Number(dramaId)] },
    ];
    for (const group of groups) {
      const rows = db.prepare(
        `SELECT id, source_key FROM ${group.table} WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id`
      ).all(Number(dramaId));
      for (const row of rows) {
        if (cleanText(row.source_key)) continue;
        const key = nextAvailableKey(db, group.table, group.scopeSql, group.scopeParams, group.prefix, row.id);
        db.prepare(`UPDATE ${group.table} SET source_key = ?, updated_at = ? WHERE id = ?`).run(key, now, row.id);
      }
    }

    const variants = db.prepare(`
      SELECT cv.id, cv.character_id, cv.source_key
      FROM character_variants cv
      INNER JOIN characters c ON c.id = cv.character_id
      WHERE c.drama_id = ? AND c.deleted_at IS NULL AND cv.deleted_at IS NULL
      ORDER BY cv.id
    `).all(Number(dramaId));
    for (const row of variants) {
      if (cleanText(row.source_key)) continue;
      const key = nextAvailableKey(db, 'character_variants', 'character_id = ?', [row.character_id], 'variant', row.id);
      db.prepare('UPDATE character_variants SET source_key = ?, updated_at = ? WHERE id = ?').run(key, now, row.id);
    }
  });
  assign();
}

function buildAssetData(db, drama) {
  const dramaId = Number(drama.id);
  const metadata = parseObject(drama.metadata);
  const style = createStyleRegistryService({ db }).requireStyle(drama.style_id);
  const characterRows = db.prepare(
    'SELECT * FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC'
  ).all(dramaId);
  const characters = [];
  const snapshot = { characters: {}, variants: {}, scenes: {}, props: {} };
  for (const row of characterRows) {
    const variants = db.prepare(
      'SELECT * FROM character_variants WHERE character_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, id ASC'
    ).all(row.id).map((variant) => {
      snapshot.variants[variant.source_key] = {
        id: variant.id,
        character_id: row.id,
        character_source_key: row.source_key,
        updated_at: variant.updated_at || null,
      };
      return {
        source_key: variant.source_key,
        name: variant.name,
        description: variant.description || '',
        appearance: variant.appearance || '',
        base_image_prompt: variant.image_prompt || '',
        negative_prompt: variant.negative_prompt || '',
        is_default: Number(variant.is_default) === 1,
      };
    });
    snapshot.characters[row.source_key] = { id: row.id, updated_at: row.updated_at || null };
    characters.push({
      source_key: row.source_key,
      name: row.name,
      role: row.role || 'minor',
      description: row.description || '',
      personality: row.personality || '',
      appearance: row.appearance || '',
      base_image_prompt: row.polished_prompt || '',
      negative_prompt: row.negative_prompt || '',
      voice_profile: row.voice_style || '',
      variants,
    });
  }

  const scenes = db.prepare(
    'SELECT * FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(dramaId).map((row) => {
    snapshot.scenes[row.source_key] = { id: row.id, updated_at: row.updated_at || null };
    return {
      source_key: row.source_key,
      name: row.location,
      state: row.state || row.time || '',
      description: row.description || '',
      atmosphere: row.atmosphere || '',
      base_image_prompt: row.prompt || '',
      negative_prompt: row.negative_prompt || '',
    };
  });

  const props = db.prepare(
    'SELECT * FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id ASC'
  ).all(dramaId).map((row) => {
    snapshot.props[row.source_key] = { id: row.id, updated_at: row.updated_at || null };
    return {
      source_key: row.source_key,
      name: row.name,
      type: row.type || '',
      description: row.description || '',
      base_image_prompt: row.prompt || '',
      negative_prompt: row.negative_prompt || '',
    };
  });

  const manifest = {
    schema: 'local-mini-drama.project-assets',
    version: '2',
    project: {
      title: drama.title || '',
      summary: drama.description || '',
      genre: drama.genre || '',
      aspect_ratio: metadata.aspect_ratio || '16:9',
      style: {
        style_id: style.id,
        label_zh: style.labelZh,
        label_en: style.labelEn,
        description_zh: style.descriptionZh,
        readonly: true,
      },
    },
    production_contract: {
      video_mode: 'multi_reference_r2v',
      uses_first_last_frame: false,
      max_reference_images: 9,
      reference_order: ['scene', 'character_variant', 'prop'],
    },
    characters,
    scenes,
    props,
  };
  return { manifest, snapshot };
}

function getCurrentAssetState(db, dramaId, options = {}) {
  const drama = getDrama(db, dramaId);
  if (options.ensureKeys !== false) ensureStableAssetKeys(db, drama.id);
  const data = buildAssetData(db, drama);
  return {
    ...data,
    assetsDigest: sha256(canonicalJson(data.manifest)),
  };
}

function buildConversationContext(db, dramaId, options = {}) {
  const drama = getDrama(db, dramaId);
  ensureStableAssetKeys(db, drama.id);
  const target = resolveTarget(db, drama.id, options);
  const metadata = parseObject(drama.metadata);
  const { manifest } = buildAssetData(db, drama);
  const previousEpisodes = db.prepare(`
    SELECT episode_number, title, description, script_content
    FROM episodes
    WHERE drama_id = ? AND deleted_at IS NULL AND episode_number < ?
    ORDER BY episode_number ASC, id ASC
  `).all(drama.id, target.episodeNumber);
  const latest = previousEpisodes.length ? previousEpisodes[previousEpisodes.length - 1] : null;
  const lines = [
    `# 《${drama.title || '未命名项目'}》第${target.episodeNumber}集剧情讨论上下文`,
    '',
    '你正在与我共同讨论下一集剧情。以下内容来自 LocalMiniDrama 当前项目，是资产和既有剧情的权威事实；如与会话记忆冲突，以这里为准。此阶段只讨论剧情，不需要输出制作 JSON。',
    '',
    '## 项目设定',
    '',
    `- 故事梗概：${drama.description || '未填写'}`,
    `- 类型：${drama.genre || '未填写'}`,
    `- 视觉风格：${manifest.project.style.label_zh}（${manifest.project.style.style_id}）`,
    `- 风格说明：${manifest.project.style.description_zh}`,
    `- 不可改变设定与连续性备注：${metadata.external_ai_continuity_notes || '未填写'}`,
    '',
    '## 已有分集',
    '',
    ...(previousEpisodes.length
      ? previousEpisodes.map((episode) => `- 第${episode.episode_number}集《${episode.title || '未命名'}》：${episode.description || '无摘要'}`)
      : ['- 当前没有已完成的前序分集。']),
  ];
  if (latest && cleanText(latest.script_content)) {
    lines.push('', `## 最近一集完整剧本（第${latest.episode_number}集）`, '', latest.script_content);
  }
  lines.push('', '## 当前角色设定', '');
  if (!manifest.characters.length) lines.push('- 当前还没有项目角色。');
  for (const character of manifest.characters) {
    lines.push(
      `### ${character.name}（${character.source_key}）`,
      '',
      `- 身份与剧情功能：${character.description || '未填写'}`,
      `- 性格：${character.personality || '未填写'}`,
      `- 基础外貌：${character.appearance || '未填写'}`,
      `- 声音：${character.voice_profile || '未填写'}`,
      `- 可用状态：${character.variants.map((variant) => `${variant.name}（${variant.source_key}）`).join('、') || '无'}`,
      '',
    );
  }
  lines.push('## 已有场景索引', '', manifest.scenes.length
    ? manifest.scenes.map((scene) => `- ${scene.name}（${scene.source_key}）：${scene.state || scene.description || '无补充'}`).join('\n')
    : '- 无');
  lines.push('', '## 已有道具索引', '', manifest.props.length
    ? manifest.props.map((prop) => `- ${prop.name}（${prop.source_key}）：${prop.description || '无补充'}`).join('\n')
    : '- 无');
  lines.push('', `现在请和我讨论第${target.episodeNumber}集剧情；不要自行改变上述既有资产的核心设定。`);
  return {
    filename: `${safeFilename(drama.title)}_第${target.episodeNumber}集_新会话剧情上下文.md`,
    markdown: lines.join('\n'),
    target_episode_number: target.episodeNumber,
  };
}

function basicResponseSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'local-mini-drama.external-ai-result',
    type: 'object',
    required: ['schema', 'version', 'prompt_contract', 'package_id', 'episode', 'new_assets', 'storyboards'],
    additionalProperties: false,
    properties: {
      schema: { const: 'local-mini-drama.external-ai-result' },
      version: { const: '2' },
      prompt_contract: { const: 'base_prompt' },
      package_id: { type: 'string', minLength: 1 },
      generator: { type: 'object' },
      audio_plan: { type: 'object' },
      episode: { type: 'object' },
      new_assets: { type: 'object' },
      storyboards: { type: 'array', minItems: 1 },
    },
  };
}

function buildInstructions(drama, target, packageId) {
  return [
    `# 《${drama.title || '未命名项目'}》第${target.episodeNumber}集制作任务`,
    '',
    `package_id：${packageId}`,
    '',
    '请把当前会话中已经确认的本集剧情整理为附件 Schema 要求的纯 JSON。',
    '',
    '必须遵守：',
    '',
    '1. 只返回 JSON，不要 Markdown 围栏或解释文字。',
    '2. 已有资产以《当前项目资产.json》为准，只在分镜中引用其 source_key，不得重复定义或修改。',
    '3. 新人物、既有人物的新状态、新场景和新道具只能放在 new_assets。',
    '4. 新人物必须完整提供性格、外貌、base_image_prompt、负向提示词、声音设定和至少一个状态。',
    '5. 分镜编号必须从 1 连续递增，所有引用必须指向已有 source_key 或本结果中的 local_ref。',
    '6. universal_segment_text 中如需引用参考图，必须使用规范槽位 @图片1、@图片2……：@图片1 对应场景，随后按 character_refs 的 sort_order 对应人物状态，最后对应 prop_refs；不要写 @场景/@人物/@道具或资产名称来代替槽位。',
    '7. package_id 必须原样返回，version 必须为字符串 2，prompt_contract 必须为 base_prompt。',
    '8. 项目风格为只读权威配置。禁止返回 style/style_id/style_prompt_*，也禁止返回 image_prompt/video_prompt/final_prompt/compiled_prompt；只能提交内容层 base_image_prompt/base_video_prompt，项目会在创建任务时编译并冻结最终提示词。',
  ].join('\n');
}

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    package_id: row.package_id,
    drama_id: row.drama_id,
    target_episode_id: row.target_episode_id,
    target_episode_number: row.target_episode_number,
    assets_digest: row.assets_digest,
    context_markdown: row.context_markdown,
    instructions_markdown: row.instructions_markdown,
    asset_manifest: JSON.parse(row.asset_manifest_json),
    asset_snapshot: JSON.parse(row.asset_snapshot_json),
    response_schema: JSON.parse(row.response_schema_json),
    created_at: row.created_at,
    imported_at: row.imported_at,
  };
}

function createTaskBundle(db, dramaId, options = {}) {
  const drama = getDrama(db, dramaId);
  const target = resolveTarget(db, drama.id, options);
  ensureStableAssetKeys(db, drama.id);
  const { manifest, snapshot } = buildAssetData(db, drama);
  const assetsDigest = sha256(canonicalJson(manifest));
  const packageId = `extai_${crypto.randomUUID()}`;
  const context = buildConversationContext(db, drama.id, {
    targetEpisodeId: target.episode?.id,
    targetEpisodeNumber: target.episodeNumber,
  });
  let responseSchema = basicResponseSchema();
  try {
    const contract = require('./externalAiResultContract');
    if (contract.EXTERNAL_AI_RESULT_SCHEMA) responseSchema = contract.EXTERNAL_AI_RESULT_SCHEMA;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  const instructions = buildInstructions(drama, target, packageId);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO external_ai_package_tasks (
      package_id, drama_id, target_episode_id, target_episode_number, assets_digest,
      context_markdown, instructions_markdown, asset_manifest_json, asset_snapshot_json,
      response_schema_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    packageId,
    drama.id,
    target.episode?.id || null,
    target.episodeNumber,
    assetsDigest,
    context.markdown,
    instructions,
    JSON.stringify(manifest),
    JSON.stringify(snapshot),
    JSON.stringify(responseSchema),
    now,
  );
  return getTaskBundle(db, packageId);
}

function getTaskBundle(db, packageId) {
  const row = db.prepare('SELECT * FROM external_ai_package_tasks WHERE package_id = ?').get(cleanText(packageId));
  return mapTaskRow(row);
}

function buildTaskZip(task) {
  if (!task) throw serviceError('PACKAGE_TASK_NOT_FOUND', '外部 AI 任务不存在');
  const zip = new AdmZip();
  zip.addFile('任务说明.md', Buffer.from(task.instructions_markdown, 'utf8'));
  zip.addFile('当前项目资产.json', Buffer.from(JSON.stringify(task.asset_manifest, null, 2), 'utf8'));
  zip.addFile('返回格式.schema.json', Buffer.from(JSON.stringify(task.response_schema, null, 2), 'utf8'));
  return zip.toBuffer();
}

module.exports = {
  TASK_SCHEMA,
  TASK_VERSION,
  canonicalJson,
  sha256,
  ensureStableAssetKeys,
  getCurrentAssetState,
  buildConversationContext,
  createTaskBundle,
  getTaskBundle,
  buildTaskZip,
};
