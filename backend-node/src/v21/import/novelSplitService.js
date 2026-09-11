'use strict';
/**
 * B2 小说/长文本拆集服务：
 * - preview(text)：按规则解析章节，给出字数与建议集号；建议集号已被占用 → conflict 标注
 * - confirm(text)：逐集创建草稿剧集 + 剧本草稿版本（零媒体任务）；冲突集跳过并给原因
 * 章节解析复用既有 novelImportService.detectChaptersByRules（不调用 AI）。
 */
function createNovelSplitService({ db, log = console } = {}) {
  const novelImportService = require('../../services/novelImportService.js');
  const { createEpisodeCenterService } = require('../episodes/episodeCenterService.js');
  const { createScriptService } = require('../script/scriptService.js');
  const episodes = createEpisodeCenterService(db, { log });
  const script = createScriptService(db, { log });

  function detect(text) {
    const chapters = novelImportService.detectChaptersByRules(String(text || ''));
    if (chapters.length === 0 && String(text || '').trim()) {
      return [{ title: '第一章', content: String(text).trim() }];
    }
    return chapters;
  }

  function existingNumbers() {
    return new Set(
      db
        .prepare('SELECT episode_number FROM episodes WHERE drama_id = (SELECT MIN(id) FROM dramas) AND deleted_at IS NULL')
        .all()
        .map((r) => r.episode_number)
    );
  }

  /** 项目内已有集数（confirm 按项目维度创建） */
  function existingNumbersFor(dramaId) {
    return new Set(
      db.prepare('SELECT episode_number FROM episodes WHERE drama_id = ? AND deleted_at IS NULL').all(Number(dramaId)).map((r) => r.episode_number)
    );
  }

  /** 未显式指定项目时，解析首个未删除项目（本地单人产品语义） */
  function resolveDramaId(dramaId) {
    if (dramaId != null) return Number(dramaId);
    const row = db.prepare('SELECT id FROM dramas WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get();
    return row ? row.id : null;
  }

  function preview(text, { maxChapters = 20, startNumber = null, dramaId = null } = {}) {
    const chapters = detect(text);
    const existing = existingNumbersFor(resolveDramaId(dramaId));
    const start = Number(startNumber) || 1;
    return {
      chapterCount: chapters.length,
      suggestedEpisodes: Math.min(chapters.length, Number(maxChapters) || 20),
      existingEpisodes: existing.size,
      startNumber: start,
      preview: chapters.slice(0, Math.min(chapters.length, Number(maxChapters) || 20)).map((chapter, i) => {
        const suggested = start + i;
        return {
          index: i + 1,
          title: chapter.title,
          chars: (chapter.content || '').length,
          suggestedEpisodeNumber: suggested,
          conflict: existing.has(suggested),
        };
      }),
    };
  }

  function confirm(text, { title = '', maxChapters = 20, startNumber = null, dramaId = null } = {}) {
    if (!String(text || '').trim()) throw Object.assign(new Error('小说文本不能为空'), { code: 'VALIDATION_ERROR', status: 400 });
    const chapters = detect(text);
    const limit = Math.min(Number(maxChapters) || 20, chapters.length);
    const projectId = resolveDramaId(dramaId);
    if (projectId == null) throw Object.assign(new Error('项目不存在或已删除'), { code: 'NOT_FOUND', status: 404 });
    let cursor = Number(startNumber) || null;
    const createdEpisodes = [];
    const skipped = [];
    for (let i = 0; i < limit; i += 1) {
      const chapter = chapters[i];
      try {
        const ep = episodes.createEpisode(projectId, { title: chapter.title || `第 ${i + 1} 集`, episodeNumber: cursor || undefined });
        const number = ep && ep.episodeNumber != null ? ep.episodeNumber : null;
        // 剧本草稿：章节标题 + 原文（仅草稿，不触发任何媒体任务）
        script.saveDraft(ep.id, { content: `${chapter.title}\n\n${chapter.content}` });
        createdEpisodes.push({ episodeId: ep.id, episodeNumber: number, title: chapter.title });
        cursor = number != null ? number + 1 : null;
      } catch (err) {
        if (err && err.code === 'EPISODE_NUMBER_CONFLICT') {
          skipped.push({ index: i + 1, title: chapter.title, reason: err.message });
          const conflictNumber = cursor;
          cursor = conflictNumber != null ? conflictNumber + 1 : null;
          continue;
        }
        throw err;
      }
    }
    log.info && log.info('V2.1 小说拆集完成', { created: createdEpisodes.length, skipped: skipped.length });
    return { episodes: createdEpisodes, skipped, total: chapters.length };
  }

  return { preview, confirm };
}

module.exports = { createNovelSplitService };
