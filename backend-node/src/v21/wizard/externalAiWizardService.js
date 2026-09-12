'use strict';
const crypto = require('node:crypto');

const { createEpisodeImportV21 } = require('../import/episodeImportV21.js');
const {
  convertExternalResultToV21,
  collectReferenceErrors,
} = require('./externalResultToV21.js');
const { validateExternalAiResult } = require('../../services/externalAiResultContract');
const {
  createTaskBundle,
  getTaskBundle,
  buildTaskZip,
  ensureStableAssetKeys,
} = require('../../services/externalAiTaskBundleService.js');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

const RESULT_SCHEMA_NAME = 'local-mini-drama.external-ai-result';

/**
 * 外部 AI 制作向导（EXT-201：独立可恢复 Page 向导，8 步）。
 * 复用既有任务包协议（externalAiTaskBundleService）与 V2.1 五步导入引擎；
 * 结果只写草稿：不自动确认剧本、不创建图片/视频/音频任务、不产生远端费用。
 */
function createExternalAiWizardService(db, { log = console } = {}) {
  const { ensureExternalAiTaskV21Columns } = require('../db.js');
  ensureExternalAiTaskV21Columns(db);
  const importer = createEpisodeImportV21(db, { log });

  const STEP_LABELS = {
    target: '选择目标',
    'compiled-context': '自动汇总上下文',
    'task-note': '补充本次要求',
    'package-preview': '预览并创建任务包',
    'waiting-result': '等待外部结果',
    'result-file': '选择结果 JSON',
    'import-preview': '预览导入',
    'imported-draft': '已导入草稿',
  };

  function requireTaskRow(packageId) {
    const row = db.prepare('SELECT * FROM external_ai_package_tasks WHERE package_id = ?').get(String(packageId));
    if (!row) throw httpError('PACKAGE_TASK_NOT_FOUND', 404, '外部 AI 任务不存在');
    return row;
  }

  function taskStatusOf(row) {
    if (row.cancelled_at) return 'cancelled';
    if (row.imported_at) return 'imported';
    return 'waiting';
  }

  function getTask(packageId) {
    const row = requireTaskRow(packageId);
    return {
      taskId: row.package_id,
      packageId: row.package_id,
      projectId: row.drama_id,
      targetEpisodeId: row.target_episode_id,
      targetEpisodeNumber: row.target_episode_number,
      assetsDigest: row.assets_digest,
      contextVersion: row.context_version || null,
      taskNote: row.task_note || '',
      instructions: row.instructions_markdown,
      context: row.context_markdown,
      status: taskStatusOf(row),
      createdAt: row.created_at,
      importedAt: row.imported_at,
      cancelledAt: row.cancelled_at,
      downloadFormats: ['任务包.zip', '单文件任务.json'],
      outputActions: [
        { id: 'download-package', label: '下载任务包' },
        { id: 'copy-prompt', label: '复制任务说明' },
        { id: 'copy-context', label: '复制完整上下文' },
        { id: 'open-task-directory', label: '打开任务目录' },
      ],
    };
  }

  /**
   * 项目外部任务列表（离页恢复入口）：
   * 按 created_at DESC 返回本项目全部外部 AI 任务及其状态判定（与 getWizardModel 一致）。
   */
  function listProjectTasks(projectId) {
    const rows = db
      .prepare('SELECT * FROM external_ai_package_tasks WHERE drama_id = ? ORDER BY created_at DESC, id DESC')
      .all(Number(projectId));
    return rows.map((row) => {
      const status = taskStatusOf(row);
      return {
        packageId: row.package_id,
        targetEpisodeId: row.target_episode_id,
        targetEpisodeNumber: row.target_episode_number,
        status: status === 'waiting' ? 'waiting_external' : status,
        taskNote: row.task_note || '',
        contextVersion: row.context_version || null,
        createdAt: row.created_at,
        importedAt: row.imported_at,
        cancelledAt: row.cancelled_at,
      };
    });
  }

  function getWizardModel(projectId, { taskId = '' } = {}) {
    const model = {
      projectId: Number(projectId),
      featureName: '外部 AI 制作',
      presentation: 'page',
      resumable: true,
      stepOrder: Object.keys(STEP_LABELS),
      stepLabels: STEP_LABELS,
      currentStep: 'target',
      target: {
        protection: '非空剧集永不可写入；只能创建下一集或填充空白剧集。',
        selectedMode: 'create_new',
        selectedEpisodeId: '',
      },
      task: taskId ? getTask(taskId) : null,
      importResult: {
        writesApprovedScript: false,
        createsMediaTasks: false,
        writesDraftOnly: true,
      },
    };
    if (taskId) {
      const task = getTask(taskId);
      model.currentStep = task.status === 'imported' ? 'imported-draft' : 'waiting-result';
      model.target.selectedMode = task.targetEpisodeId ? 'fill_blank' : 'create_new';
      model.target.selectedEpisodeId = task.targetEpisodeId ? String(task.targetEpisodeId) : '';
    }
    return model;
  }

  function selectTarget(projectId, { mode = 'create_new', episodeId = null } = {}) {
    if (!['create_new', 'fill_blank'].includes(mode)) {
      throw httpError('VALIDATION_ERROR', 400, '目标模式必须为 create_new 或 fill_blank');
    }
    if (mode === 'fill_blank') {
      if (!episodeId) throw httpError('VALIDATION_ERROR', 400, '填充空白集必须指定剧集');
      const row = db
        .prepare('SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL')
        .get(Number(episodeId), Number(projectId));
      if (!row) throw httpError('NOT_FOUND', 404, '目标剧集不存在');
      const blank = importer ? null : null;
      void blank;
      const episodeCenter = require('../episodes/episodeCenterService.js');
      const center = episodeCenter.createEpisodeCenterService(db, { log });
      const status = center.getBlankStatus(row.id);
      if (!status.blank) {
        throw httpError('TARGET_NOT_BLANK', 409, '非空剧集永不可写入，只能选择空白剧集');
      }
      return { mode, episodeId: row.id, episodeNumber: row.episode_number };
    }
    return { mode, episodeId: null, episodeNumber: null };
  }

  function createPackage(projectId, { mode = 'create_new', episodeId = null, taskNote = '' } = {}) {
    const target = selectTarget(projectId, { mode, episodeId });
    ensureStableAssetKeys(db, Number(projectId));
    const task = createTaskBundle(db, Number(projectId), {
      targetEpisodeId: target.episodeId || undefined,
      targetEpisodeNumber: target.episodeNumber || undefined,
    });
    const contextVersion = sha256Text(`${task.context_markdown}::${task.assets_digest}`);
    db.prepare(
      'UPDATE external_ai_package_tasks SET task_note = ?, context_version = ? WHERE package_id = ?'
    ).run(taskNote || '', contextVersion, task.package_id);
    log.info?.('V2.1 外部 AI 任务包已创建', { packageId: task.package_id, mode });
    return {
      taskId: task.package_id,
      packageId: task.package_id,
      assetsDigest: task.assets_digest,
      contextVersion,
      targetEpisodeNumber: task.target_episode_number,
      targetEpisodeId: task.target_episode_id,
      downloadFormats: ['任务包.zip', '单文件任务.json'],
    };
  }

  function saveTaskNote(packageId, { note = '' } = {}) {
    const row = requireTaskRow(packageId);
    if (row.imported_at) throw httpError('TASK_IMMUTABLE', 409, '任务已导入，不能修改补充说明');
    db.prepare('UPDATE external_ai_package_tasks SET task_note = ? WHERE package_id = ?').run(
      String(note || ''),
      row.package_id
    );
    return getTask(packageId);
  }

  function buildDownload(packageId, { format = 'zip' } = {}) {
    const row = requireTaskRow(packageId);
    if (format === 'zip') {
      return {
        contentType: 'application/zip',
        contentDisposition: `attachment; filename="${row.package_id}.zip"`,
        body: buildTaskZip(getTaskBundle(db, row.package_id)),
      };
    }
    if (format === 'json') {
      const task = getTaskBundle(db, row.package_id);
      const payload = {
        schema: 'local-mini-drama.external-ai-task',
        version: '2.1',
        package_id: task.package_id,
        assets_digest: task.assets_digest,
        target_episode_number: task.target_episode_number,
        instructions: task.instructions_markdown,
        context: task.context_markdown,
        asset_manifest: task.asset_manifest,
        response_schema: task.response_schema,
      };
      return {
        contentType: 'application/json; charset=utf-8',
        contentDisposition: `attachment; filename="${row.package_id}.json"`,
        body: JSON.stringify(payload, null, 2),
      };
    }
    throw httpError('VALIDATION_ERROR', 400, 'format 必须为 zip 或 json');
  }

  function cancelTask(packageId) {
    const row = requireTaskRow(packageId);
    if (row.imported_at) throw httpError('TASK_IMMUTABLE', 409, '任务已导入，不能取消');
    db.prepare('UPDATE external_ai_package_tasks SET cancelled_at = ? WHERE package_id = ?').run(
      new Date().toISOString(),
      row.package_id
    );
    return getTask(packageId);
  }

  function parseResultJson(resultJson) {
    let result;
    try {
      result = JSON.parse(resultJson);
    } catch (err) {
      throw httpError('RESULT_JSON_INVALID', 400, `结果不是合法 JSON：${err.message}`);
    }
    if (!result || typeof result !== 'object') {
      throw httpError('RESULT_JSON_INVALID', 400, '结果必须是 JSON 对象');
    }
    return result;
  }

  /** 结果校验（EXT-201 requiredChecks）；返回逐项检查结果，不抛错 */
  function validateResult(packageId, resultJson) {
    const row = requireTaskRow(packageId);
    const checks = [];
    const push = (id, label, ok, detail = '') => checks.push({ id, label, ok: Boolean(ok), detail });

    let result = null;
    try {
      result = parseResultJson(resultJson);
    } catch (err) {
      push('schema', 'Schema 协议版本', false, err.message);
      return { ok: false, checks, errors: [err.message] };
    }

    push('schema', 'Schema 协议版本', result.schema === RESULT_SCHEMA_NAME && String(result.version) === '2',
      `schema=${result.schema} version=${result.version}`);
    push('package_id', '任务包 ID 匹配', result.package_id === row.package_id,
      `结果 ${result.package_id} vs 任务 ${row.package_id}`);
    push('project', '目标项目匹配', Boolean(row.drama_id),
      `任务绑定项目 #${row.drama_id}`);
    const episodeOk = result.episode && Number(result.episode.episode_number) === Number(row.target_episode_number);
    push('episode', '目标剧集匹配', episodeOk,
      `结果第 ${result.episode?.episode_number} 集 vs 任务目标第 ${row.target_episode_number} 集`);
    const digestAbsent = result.assets_digest === undefined || result.assets_digest === null;
    const digestOk = digestAbsent || result.assets_digest === row.assets_digest;
    push('assets_digest', '素材快照摘要匹配', digestOk,
      digestAbsent
        ? '结果未携带 assets_digest（按返回格式 Schema 可省略）；导入将按任务包冻结快照校验引用'
        : digestOk
          ? 'assets_digest 与任务包冻结值一致'
          : 'assets_digest 与任务包冻结值不一致（多为外部 AI 转写时改动了该字段，或建包后项目素材已变化）');

    // 资产映射：包 Schema 结构校验 + 引用完整性（与导入转换共用同一套规则）
    const mappingErrors = [];
    const contract = validateExternalAiResult(result);
    if (!contract.ok) {
      mappingErrors.push(...contract.errors.slice(0, 3).map((e) => `${e.path || '(root)'}: ${e.message}`));
    } else {
      let manifest = {};
      try {
        manifest = JSON.parse(row.asset_manifest_json || '{}');
      } catch (_) {
        manifest = {};
      }
      mappingErrors.push(...collectReferenceErrors(result, manifest).slice(0, 3));
    }
    push('asset-mapping', '人物、场景、道具映射完整', mappingErrors.length === 0, mappingErrors.join('；'));

    // 非空目标保护（fill 模式在导入引擎事务内还会重检）
    if (row.target_episode_id) {
      const center = require('../episodes/episodeCenterService.js');
      const status = center.createEpisodeCenterService(db, { log }).getBlankStatus(row.target_episode_id);
      push('nonempty-target', '目标仍为空白剧集', status.blank, status.reasons.map((r) => r.detail).join('；'));
    } else {
      const occupied = db
        .prepare('SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL')
        .get(row.drama_id, row.target_episode_number);
      push('nonempty-target', '目标集号未被占用', !occupied, occupied ? `第 ${row.target_episode_number} 集已存在` : '');
    }

    return { ok: checks.every((c) => c.ok), checks, errors: checks.filter((c) => !c.ok).map((c) => c.detail || c.label) };
  }

  /**
   * 确定性适配：external-ai-result@2（任务包返回格式：storyboards/local_ref）→ 规范 episode-package@2.1（不写库）。
   * assets_digest 回执缺失不阻断（转换后按冻结快照校验全部既有引用）；提供但不一致时才要求 frozenSnapshot。
   */
  function adaptResult(packageId, result, options = {}) {
    const row = requireTaskRow(packageId);
    if (result.schema !== RESULT_SCHEMA_NAME || String(result.version) !== '2') {
      throw httpError(
        'PACKAGE_SCHEMA_UNSUPPORTED',
        400,
        `粘贴的内容不是外部 AI 结果 JSON（需要 schema="local-mini-drama.external-ai-result" 且 version="2"，实际收到 schema=${result.schema || '（缺失）'}、version=${result.version === undefined ? '（缺失）' : result.version}）。请确认粘贴的是外部 AI 返回的结果，而不是任务书 episode-task.json`
      );
    }
    if (result.package_id !== row.package_id) {
      throw httpError('PACKAGE_TASK_MISMATCH', 409, '结果中的 package_id 与任务不匹配');
    }
    const digestProvided = result.assets_digest !== undefined && result.assets_digest !== null;
    const digestMatched = digestProvided && result.assets_digest === row.assets_digest;
    if (digestProvided && !digestMatched && !options.frozenSnapshot) {
      throw httpError('ASSETS_DIGEST_MISMATCH', 409, '素材快照摘要与任务包不一致（上下文已变化）');
    }
    if (Number(result.episode?.episode_number) !== Number(row.target_episode_number)) {
      throw httpError('PACKAGE_TARGET_MISMATCH', 409, '结果集号与任务目标不一致');
    }

    let manifest = {};
    try {
      manifest = JSON.parse(row.asset_manifest_json || '{}');
    } catch (_) {
      manifest = {};
    }
    const adapted = convertExternalResultToV21(result, {
      packageId: row.package_id,
      assetsDigest: row.assets_digest,
      manifest,
    });
    return { canonical: adapted.package, warnings: adapted.warnings, assetDigestStatus: adapted.assetDigestStatus, digestProvided, digestMatched };
  }

  function previewImport(packageId, resultJson, options = {}) {
    const row = requireTaskRow(packageId);
    const result = parseResultJson(resultJson);
    const adapted = adaptResult(packageId, result, options);
    const plan = importer.buildImportPlan(db, adapted.canonical, {
      dramaId: row.drama_id,
      targetEpisodeId: row.target_episode_id,
      sourceFilename: 'external-ai-result.json',
      sourceSha256: sha256Text(resultJson),
    });
    if (options.frozenSnapshot && adapted.digestProvided && !adapted.digestMatched) plan.frozenSnapshot = true;
    plan.assetDigestStatus = adapted.assetDigestStatus;
    if (adapted.warnings.length > 0) plan.externalWarnings = adapted.warnings;
    return plan;
  }

  function confirmImport(packageId, resultJson, options = {}) {
    const row = requireTaskRow(packageId);
    if (row.imported_at) throw httpError('PACKAGE_ALREADY_IMPORTED', 409, '该任务已成功导入，不能重复使用');
    if (row.cancelled_at) throw httpError('TASK_CANCELLED', 409, '任务已取消，不能导入');
    const result = parseResultJson(resultJson);
    const adapted = adaptResult(packageId, result, options);
    const frozenUsed = Boolean(options.frozenSnapshot) && adapted.digestProvided && !adapted.digestMatched;
    if (!row.target_episode_id) {
      const occupied = db
        .prepare('SELECT id FROM episodes WHERE drama_id = ? AND episode_number = ? AND deleted_at IS NULL')
        .get(row.drama_id, row.target_episode_number);
      if (occupied) {
        throw httpError('PACKAGE_TARGET_OCCUPIED', 409, `任务目标第 ${row.target_episode_number} 集已存在，请重新生成任务包`);
      }
    }
    const reportExtra = {};
    if (frozenUsed) reportExtra.frozenSnapshot = true;
    if (adapted.warnings.length > 0) reportExtra.externalWarnings = adapted.warnings.map((w) => w.code);
    const imported = importer.confirmImport(db, {
      pkg: adapted.canonical,
      dramaId: row.drama_id,
      targetEpisodeId: row.target_episode_id,
      sourceFilename: 'external-ai-result.json',
      sourceSha256: sha256Text(resultJson),
      taskPackageId: row.package_id,
      sourceLabel: 'external-ai-result@2',
      reportExtra: Object.keys(reportExtra).length > 0 ? reportExtra : null,
    });
    // 原子回填：imported_at + target_episode_id（create_new 导入后才有真实集 id，剧集中心「打开剧本」与离页恢复依赖）
    db.prepare(
      'UPDATE external_ai_package_tasks SET imported_at = ?, target_episode_id = COALESCE(target_episode_id, ?) WHERE package_id = ?'
    ).run(
      new Date().toISOString(),
      imported.episodeId,
      row.package_id
    );
    return {
      ...imported,
      targetEpisodeNumber: row.target_episode_number,
      assetDigestStatus: adapted.assetDigestStatus,
      ...(frozenUsed ? { frozenSnapshot: true } : {}),
      opensRoute: { routeId: 'studio-script', params: { projectId: row.drama_id, episodeId: imported.episodeId } },
    };
  }

  return {
    getWizardModel,
    listProjectTasks,
    selectTarget,
    createPackage,
    getTask,
    saveTaskNote,
    buildDownload,
    cancelTask,
    validateResult,
    adaptResult,
    previewImport,
    confirmImport,
  };
}

module.exports = { createExternalAiWizardService };
