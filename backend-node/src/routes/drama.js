const dramaService = require('../services/dramaService');
const propService = require('../services/propService');
const response = require('../response');
const dramaExportService = require('../services/dramaExportService');
const dramaImportService = require('../services/dramaImportService');
const projectDeletionService = require('../services/projectDeletionService');
const path = require('node:path');
const fs = require('node:fs');
const {
  normalizeEpisodeAudioPlan,
  serializeCanonicalJson,
} = require('../services/storyboardAvContractService');
const { ensureEpisodeAudioPlan } = require('../services/episodeAudioPlanService');
const {
  projectEpisodeRow,
  projectStoryboardRow,
  patchStoryboard,
} = require('../services/storyboardCanonicalRepository');

function validateEpisodeBgmPath(value, cfg) {
  if (value == null || String(value).trim() === '') return null;
  const storageRoot = path.resolve(cfg?.storage?.local_path || './data/storage');
  const raw = String(value).trim();
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(storageRoot, raw);
  const relative = path.relative(storageRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('BGM 路径必须位于项目媒体存储目录内');
    error.code = 'EPISODE_AUDIO_PATH_INVALID';
    throw error;
  }
  if (fs.existsSync(candidate) && fs.existsSync(storageRoot)) {
    const realRoot = fs.realpathSync(storageRoot);
    const realCandidate = fs.realpathSync(candidate);
    const realRelative = path.relative(realRoot, realCandidate);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      const error = new Error('BGM 文件不能通过符号链接指向项目媒体目录之外');
      error.code = 'EPISODE_AUDIO_PATH_INVALID';
      throw error;
    }
  }
  return relative.replace(/\\/g, '/');
}

function loadEpisodeAudioResponse(db, episodeId) {
  const episodeRow = db.prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episodeRow) return null;
  const storyboards = db.prepare(
    'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number, id',
  ).all(Number(episodeId)).map((row) => projectStoryboardRow(row));
  return { episode: projectEpisodeRow(episodeRow), storyboards };
}

function reconcileShotMusicCuesWithEpisodePlan(db, episodeId, bgmMode, now) {
  if (bgmMode === 'per_segment') return;
  const rows = db.prepare(
    'SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL',
  ).all(Number(episodeId));
  for (const row of rows) {
    const cue = projectStoryboardRow(row).audio_description?.music_cue;
    if (cue?.mode === 'mute' && cue.prompt == null && Number(cue.intensity || 0) === 0) continue;
    patchStoryboard(db, row.id, {
      audio_description: {
        music_cue: { mode: 'mute', prompt: null, intensity: 0 },
      },
    }, {
      source: 'episode_audio_plan',
      lock: false,
      now,
    });
  }
}

function updateEpisodeAudioPlan(db, log, cfg) {
  return (req, res) => {
    try {
      const current = db.prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(req.params.id));
      if (!current) return response.notFound(res, '剧集不存在');
      const incoming = req.body?.audio_plan ?? req.body ?? {};
      const prior = normalizeEpisodeAudioPlan(current.audio_plan);
      const plan = normalizeEpisodeAudioPlan({
        ...prior,
        ...incoming,
        bgm: { ...prior.bgm, ...(incoming.bgm || {}) },
        speech: { ...prior.speech, ...(incoming.speech || {}) },
        mastering: { ...prior.mastering, ...(incoming.mastering || {}) },
        field_state: { ...(prior.field_state || {}), ...(incoming.field_state || {}) },
      }, { source: 'manual' });
      if (plan.bgm.local_path) plan.bgm.local_path = validateEpisodeBgmPath(plan.bgm.local_path, cfg);
      if (plan.bgm.local_path && plan.bgm.source_type === 'none') plan.bgm.source_type = 'local_file';
      const now = new Date().toISOString();
      plan.field_state = { ...(prior.field_state || {}), ...(plan.field_state || {}) };
      for (const group of ['bgm', 'speech', 'mastering']) {
        for (const key of Object.keys(plan[group] || {})) {
          if (JSON.stringify(plan[group][key]) !== JSON.stringify(prior[group]?.[key])) {
            const field = `${group}.${key}`;
            plan.field_state[field] = {
              source: 'manual', locked: true,
              revision: Number(prior.field_state?.[field]?.revision || 0) + 1,
              updated_at: now,
            };
          }
        }
      }
      const unlockFields = req.body?.unlock_fields || incoming.unlock_fields || [];
      if (!Array.isArray(unlockFields)) {
        const error = new Error('unlock_fields 必须是数组');
        error.code = 'STORYBOARD_AV_CONTRACT_INVALID';
        throw error;
      }
      for (const field of unlockFields) {
        if (!/^(bgm|speech|mastering)\.[a-z_]+$/.test(String(field))) {
          const error = new Error(`不能解锁音频策略字段 ${field}`);
          error.code = 'STORYBOARD_AV_CONTRACT_INVALID';
          throw error;
        }
        const previous = plan.field_state[field] || { source: 'default', revision: 0 };
        plan.field_state[field] = {
          ...previous,
          locked: false,
          revision: Number(previous.revision || 0) + 1,
          updated_at: now,
        };
      }
      plan.provenance = { ...(plan.provenance || {}), source: 'manual', updated_at: now };
      db.transaction(() => {
        db.prepare('UPDATE episodes SET audio_plan = ?, updated_at = ? WHERE id = ?')
          .run(serializeCanonicalJson(plan), now, Number(req.params.id));
        reconcileShotMusicCuesWithEpisodePlan(db, req.params.id, plan.bgm.mode, now);
      })();
      response.success(res, loadEpisodeAudioResponse(db, req.params.id));
    } catch (error) {
      log.error('Update episode audio plan failed', { code: error.code, error: error.message });
      if (error.code === 'STORYBOARD_AV_CONTRACT_INVALID' || error.code === 'EPISODE_AUDIO_PATH_INVALID') {
        return response.error(res, 400, error.code, error.message);
      }
      response.internalError(res, error.message);
    }
  };
}

function planEpisodeAudio(db, log) {
  return async (req, res) => {
    try {
      const plan = await ensureEpisodeAudioPlan(db, log, { episodeId: Number(req.params.id), force: true });
      const payload = loadEpisodeAudioResponse(db, req.params.id);
      if (!payload) return response.notFound(res, '剧集不存在');
      response.success(res, { ...payload, audio_plan: plan });
    } catch (error) {
      log.error('Plan episode audio failed', { code: error.code, error: error.message });
      if (error.code === 'EPISODE_AUDIO_PLAN_INVALID') return response.error(res, 400, error.code, error.message);
      response.internalError(res, error.message);
    }
  };
}

function createDrama(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.title || String(body.title).trim() === '') {
      return response.badRequest(res, '标题不能为空');
    }
    try {
      const drama = dramaService.createDrama(db, log, body);
      response.created(res, drama);
    } catch (err) {
      log.error('Create drama failed', { error: err.message, stack: err.stack });
      response.internalError(res, err.message || '创建失败');
    }
  };
}

function getDrama(db, cfg) {
  return (req, res) => {
    const drama = dramaService.getDrama(db, req.params.id, cfg?.storage?.base_url);
    if (!drama) return response.notFound(res, '剧本不存在');
    response.success(res, drama);
  };
}

function listDramas(db, log) {
  return (req, res) => {
    const page = req.query.page || 1;
    const page_size = req.query.page_size || 20;
    const status = req.query.status || '';
    const genre = req.query.genre || '';
    const keyword = req.query.keyword || '';
    try {
      const { dramas, total, page: p, pageSize: ps } = dramaService.listDramas(db, {
        page,
        page_size,
        status,
        genre,
        keyword,
      });
      response.successWithPagination(res, dramas, total, p, ps);
    } catch (err) {
      log.errorw('List dramas failed', { error: err.message });
      response.internalError(res, '获取列表失败');
    }
  };
}

function updateDrama(db, log) {
  return (req, res) => {
    const drama = dramaService.updateDrama(db, log, req.params.id, req.body || {});
    if (!drama) return response.notFound(res, '剧本不存在');
    response.success(res, drama);
  };
}

function deleteDrama(db, cfg, log) {
  return (req, res) => {
    try {
      const result = projectDeletionService.deleteProjectPermanently(db, cfg, log, req.params.id);
      if (!result) return response.notFound(res, '剧本不存在');
      response.success(res, result);
    } catch (error) {
      log.error('Delete drama permanently failed', { drama_id: req.params.id, error: error.message });
      response.internalError(res, error.message || '删除失败');
    }
  };
}

function deleteEpisode(db, log) {
  return (req, res) => {
    try {
      const result = projectDeletionService.deleteEpisodePermanently(db, log, req.params.id);
      if (!result) return response.notFound(res, '剧集不存在');
      response.success(res, result);
    } catch (error) {
      log.error('Delete episode permanently failed', { episode_id: req.params.id, error: error.message });
      response.internalError(res, error.message || '删除失败');
    }
  };
}

function getDramaStats(db, log) {
  return (req, res) => {
    try {
      const stats = dramaService.getDramaStats(db);
      response.success(res, stats);
    } catch (err) {
      log.errorw('Get drama stats failed', { error: err.message });
      response.internalError(res, '获取统计失败');
    }
  };
}

function saveOutline(db, log) {
  return (req, res) => {
    const ok = dramaService.saveOutline(db, log, req.params.id, req.body || {});
    if (!ok) return response.notFound(res, '剧本不存在');
    response.success(res, { message: '保存成功' });
  };
}

function getCharacters(db) {
  return (req, res) => {
    const characters = dramaService.getCharacters(db, req.params.id, req.query.episode_id);
    if (characters === null) return response.notFound(res, '剧本或章节不存在');
    response.success(res, characters);
  };
}

function saveCharacters(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.characters)) return response.badRequest(res, 'characters 必填且为数组');
    const ok = dramaService.saveCharacters(db, log, req.params.id, body);
    if (!ok) return response.notFound(res, '剧本或章节不存在');
    response.success(res, { message: '保存成功' });
  };
}

function saveEpisodes(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.episodes)) return response.badRequest(res, 'episodes 必填且为数组');
    const ok = dramaService.saveEpisodes(db, log, req.params.id, body);
    if (!ok) return response.notFound(res, '剧本不存在');
    response.success(res, { message: '保存成功' });
  };
}

function saveProgress(db, log) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.current_step) return response.badRequest(res, 'current_step 必填');
    const ok = dramaService.saveProgress(db, log, req.params.id, body);
    if (!ok) return response.notFound(res, '剧本不存在');
    response.success(res, { message: '保存成功' });
  };
}

function saveCanvasLayout(db, log) {
  return (req, res) => {
    try {
      const updated = dramaService.saveCanvasLayout(db, log, req.params.id, req.body || {});
      if (!updated) return response.notFound(res, '剧本不存在');
      response.success(res, updated);
    } catch (err) {
      if (err.code === 'BAD_REQUEST') return response.badRequest(res, err.message);
      log.error('Save canvas layout failed', { error: err.message });
      response.internalError(res, err.message || '保存画布布局失败');
    }
  };
}

function listProps(db) {
  return (req, res) => {
    const props = propService.listByDramaId(db, req.params.id);
    response.success(res, props);
  };
}

function finalizeEpisode(db, log, cfg) {
  return (req, res) => {
    const episodeId = req.params.episode_id;
    if (!episodeId) return response.badRequest(res, 'episode_id不能为空');
    const baseUrl = cfg?.storage?.base_url || '';
    const result = dramaService.finalizeEpisode(db, log, episodeId, baseUrl, req.body || {});
    if (!result) return response.notFound(res, '剧集不存在');
    response.success(res, result);
  };
}

function downloadEpisodeVideo(db) {
  return (req, res) => {
    const episodeId = req.params.episode_id;
    if (!episodeId) return response.badRequest(res, 'episode_id不能为空');
    const result = dramaService.downloadEpisodeVideo(db, episodeId);
    if (!result) return response.notFound(res, '剧集不存在');
    if (result.error) return response.badRequest(res, result.error);
    response.success(res, result);
  };
}

function exportDrama(db, cfg, log) {
  return (req, res) => {
    try {
      const { buffer, title } = dramaExportService.exportDrama(db, cfg, log, req.params.id);
      const safeName = (title || 'drama').replace(/[^\w\u4e00-\u9fff\-]/g, '_').slice(0, 50);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.zip`);
      res.send(buffer);
    } catch (err) {
      log.error('Export drama failed', { error: err.message });
      response.internalError(res, err.message || '导出失败');
    }
  };
}

function importDrama(db, cfg, log) {
  return (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, '请上传 ZIP 文件');
      }
      const result = dramaImportService.importDrama(db, cfg, log, req.file.buffer);
      response.created(res, result);
    } catch (err) {
      log.error('Import drama failed', { error: err.message });
      if (err.message && (err.message.includes('格式') || err.message.includes('缺少') || err.message.includes('损坏'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '导入失败');
    }
  };
}

function getExampleDramaDir() {
  const path = require('path');
  const fs = require('fs');
  if (process.env.EXAMPLE_DRAMA_PATH && fs.existsSync(process.env.EXAMPLE_DRAMA_PATH)) {
    return process.env.EXAMPLE_DRAMA_PATH;
  }
  const devPath = path.join(__dirname, '..', '..', '..', 'example_drama');
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

function listExamples(log) {
  return (_req, res) => {
    const fs = require('fs');
    const dir = getExampleDramaDir();
    if (!dir) return response.success(res, []);
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.zip'));
      const items = files.map(f => {
        const name = f.replace(/\.zip$/, '');
        return { filename: f, name };
      });
      response.success(res, items);
    } catch (err) {
      log.error('List examples failed', { error: err.message });
      response.success(res, []);
    }
  };
}

function importExample(db, cfg, log) {
  return (req, res) => {
    const fs = require('fs');
    const path = require('path');
    const filename = req.body?.filename;
    if (!filename) return response.badRequest(res, '请指定示例文件名');
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return response.badRequest(res, '文件名不合法');
    }
    const dir = getExampleDramaDir();
    if (!dir) return response.badRequest(res, '示例目录不存在');
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) return response.notFound(res, '示例文件不存在');
    try {
      const buffer = fs.readFileSync(filePath);
      const result = dramaImportService.importDrama(db, cfg, log, buffer);
      response.created(res, result);
    } catch (err) {
      log.error('Import example failed', { error: err.message });
      response.internalError(res, err.message || '导入示例失败');
    }
  };
}

function generateStoryboard(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    try {
      // 显式处理 model 为空的情况，转为 undefined 以便 service 层触发默认逻辑
      const model = (body.model && String(body.model).trim()) ? body.model : undefined;
      log.info('Generate storyboard request', { episode_id: req.params.episode_id, storyboard_count: body.storyboard_count, video_duration: body.video_duration });
      const resData = await dramaService.generateStoryboard(db, log, req.params.episode_id, {
        model: model,
        style: body.style,
        storyboard_count: body.storyboard_count,
        video_duration: body.video_duration,
        aspect_ratio: body.aspect_ratio,
        include_narration: body.include_narration,
        universal_omni_storyboard: body.universal_omni_storyboard,
      });
      response.success(res, resData);
    } catch (err) {
      log.error('Generate storyboard failed', { error: err.message });
      response.internalError(res, err.message || '生成分镜失败');
    }
  };
}

module.exports = function dramaRoutes(db, cfg, log) {
  return {
    createDrama: createDrama(db, log),
    getDrama: getDrama(db, cfg),
    listDramas: listDramas(db, log),
    updateDrama: updateDrama(db, log),
    deleteDrama: deleteDrama(db, cfg, log),
    deleteEpisode: deleteEpisode(db, log),
    getDramaStats: getDramaStats(db, log),
    saveOutline: saveOutline(db, log),
    getCharacters: getCharacters(db),
    saveCharacters: saveCharacters(db, log),
    saveEpisodes: saveEpisodes(db, log),
    saveProgress: saveProgress(db, log),
    saveCanvasLayout: saveCanvasLayout(db, log),
    listProps: listProps(db),
    finalizeEpisode: finalizeEpisode(db, log, cfg),
    downloadEpisodeVideo: downloadEpisodeVideo(db),
    generateStoryboard: generateStoryboard(db, log),
    exportDrama: exportDrama(db, cfg, log),
    importDrama: importDrama(db, cfg, log),
    listExamples: listExamples(log),
    importExample: importExample(db, cfg, log),
    updateEpisodeAudioPlan: updateEpisodeAudioPlan(db, log, cfg),
    planEpisodeAudio: planEpisodeAudio(db, log),
  };
};
