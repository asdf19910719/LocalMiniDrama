'use strict';
const crypto = require('node:crypto');

const { createStageStateService } = require('../stage/stageStateService.js');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

const SCENE_HEADING_RE =
  /^\s*(?:(内景|外景|内|外)[·\s·]*)?(?:(第[一二三四五六七八九十百千0-9]+场)|(\d{1,3})[.、、])?\s*[·\s]*([^·\n]*?)\s*[·\s]*((?:清晨|早晨|早上|上午|中午|午后|下午|黄昏|傍晚|夜晚|深夜|凌晨|日|夜|黄昏))?$/;

/**
 * V2.1 剧本阶段服务（SCRIPT-201：草稿优先，确认只是批准版本）。
 * - 草稿持久化：未保存 → 保存中（前端）→ 已保存；expected_revision 乐观锁（REVISION_CONFLICT 409）
 * - 场次结构：草稿保存即解析并可编辑（story_scenes）
 * - AI 候选：先生成候选与 diff，应用后才写草稿（无 Key 时使用确定性 mock 文本通道）
 * - 确认：只批准版本并写失效事实，不删除/覆盖/重新生成任何媒体
 */
function createScriptService(db, { log = console } = {}) {
  const stages = createStageStateService(db, { log });

  function requireEpisode(episodeId) {
    const row = db
      .prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL')
      .get(Number(episodeId));
    if (!row) throw httpError('NOT_FOUND', 404, '剧集不存在或已删除');
    return row;
  }

  function getDraftRow(episodeId) {
    return db
      .prepare(
        `SELECT * FROM episode_script_revisions
         WHERE episode_id = ? AND status IN ('draft','ready_for_review')
         ORDER BY revision DESC LIMIT 1`
      )
      .get(Number(episodeId));
  }

  function getApprovedRow(episodeId) {
    return db
      .prepare(
        `SELECT * FROM episode_script_revisions
         WHERE episode_id = ? AND status = 'approved' ORDER BY revision DESC LIMIT 1`
      )
      .get(Number(episodeId));
  }

  function saveDraft(episodeId, { content = '', title = '', expectedRevision = null } = {}) {
    const episode = requireEpisode(episodeId);
    let draft = getDraftRow(episodeId);
    if (!draft) {
      const derivedFrom = getApprovedRow(episodeId);
      const nextRev = (db
        .prepare('SELECT COALESCE(MAX(revision), 0) AS n FROM episode_script_revisions WHERE episode_id = ?')
        .get(episodeId).n) + 1;
      const info = db
        .prepare(
          `INSERT INTO episode_script_revisions (episode_id, revision, status, title, content, source, parent_revision_id, created_at, updated_at)
           VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          episodeId,
          nextRev,
          title || episode.title || '',
          String(content),
          derivedFrom ? 'edit-after-approve' : 'manual',
          derivedFrom ? derivedFrom.id : null,
          nowIso(),
          nowIso()
        );
      draft = db.prepare('SELECT * FROM episode_script_revisions WHERE id = ?').get(info.lastInsertRowid);
      stages.ensureStage(episode.drama_id, episodeId, 'script');
      stages.markInProgress(episodeId, 'script', { contentRevision: draft.revision });
    } else {
      if (expectedRevision !== null && expectedRevision !== undefined) {
        if (Number(expectedRevision) !== Number(draft.revision)) {
          throw httpError(
            'REVISION_CONFLICT',
            409,
            `expected_revision ${expectedRevision} 与当前草稿 ${draft.revision} 不匹配`
          );
        }
      }
      db.prepare(
        'UPDATE episode_script_revisions SET content = ?, title = COALESCE(NULLIF(?, \'\'), title), updated_at = ? WHERE id = ?'
      ).run(String(content), title || '', nowIso(), draft.id);
    }
    // 保存即后台轻量解析场次（同步执行，失败不影响草稿保存）
    try {
      parseScenes(episodeId);
    } catch (err) {
      log.warn?.('场次解析失败（不影响草稿保存）', { error: err.message });
    }
    return {
      revisionId: draft.id,
      revision: draft.revision,
      status: draft.status,
      saveState: 'saved',
      savedAt: nowIso(),
    };
  }

  /** 确定性场次解析：标题行 = 场号/内外景/地点/时间；标题行之间的正文归入当前场 */
  function parseScenes(episodeId) {
    const draft = getDraftRow(episodeId);
    if (!draft) return [];
    const lines = String(draft.content || '').split('\n');
    const scenes = [];
    let current = null;
    for (const line of lines) {
      const trimmed = line.trim();
      const headingLike = /^(第[一二三四五六七八九十百千0-9]+场|\d{1,3}[.、、])|^((内景|外景)[·\s])/.test(trimmed);
      if (headingLike && trimmed.length <= 40) {
        if (current) scenes.push(current);
        const headingText = trimmed.replace(/^第[一二三四五六七八九十百千0-9]+场\s*/, '');
        const match = headingText.match(SCENE_HEADING_RE) || [];
        current = {
          heading: headingText,
          interiorExterior: match[1] || '',
          location: (match[4] || '').trim(),
          timeOfDay: match[5] || '',
          summary: '',
        };
      } else if (current && trimmed) {
        if (!current.summary) current.summary = trimmed;
        current.summary = `${current.summary}`.slice(0, 200);
      }
    }
    if (current) scenes.push(current);

    // 持久化（整集重解析：先清后写，保持 scene_number 连续）
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM story_scenes WHERE episode_id = ?').get ? db.prepare('DELETE FROM story_scenes WHERE episode_id = ?').run(episodeId) : null;
      scenes.forEach((scene, index) => {
        db.prepare(
          `INSERT INTO story_scenes (episode_id, script_revision_id, scene_key, scene_number, heading, interior_exterior, location, time_of_day, summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          episodeId,
          draft.id,
          `EP${episodeId}_SC${String(index + 1).padStart(2, '0')}`,
          index + 1,
          scene.heading,
          scene.interiorExterior,
          scene.location,
          scene.timeOfDay,
          scene.summary,
          nowIso()
        );
      });
      db.prepare('UPDATE episode_script_revisions SET scene_count = ? WHERE id = ?').run(scenes.length, draft.id);
    });
    tx();
    return scenes;
  }

  function listScenes(episodeId) {
    return db
      .prepare('SELECT * FROM story_scenes WHERE episode_id = ? ORDER BY scene_number')
      .all(Number(episodeId));
  }

  /** AI 候选（无 Key 时确定性 mock：追加场次骨架并标注） */
  function generateAiCandidate(episodeId, { mode = 'polish', selection = '' } = {}) {
    const draft = getDraftRow(episodeId);
    if (!draft) throw httpError('NOT_FOUND', 404, '尚无草稿，请先保存');
    const base = String(draft.content || '');
    let text;
    if (mode === 'polish' || mode === 'rewrite') {
      text = base
        .split('\n')
        .map((line) => (line.trim() && !/^(第.*场|内景|外景)/.test(line.trim()) ? `${line}（润色）` : line))
        .join('\n');
    } else {
      text = `${base}\n\n第三场 内景·酒店前台·清晨\n（AI 续写）晨光穿过旋转门，林夏攥着未写完的交接单。`;
    }
    if (selection) {
      text = base.replace(selection, `${selection}（已改写）`);
    }
    const diff = computeDiff(base, text);
    return {
      id: `cand_${Date.now().toString(36)}`,
      mode,
      text,
      diff,
      provider: 'mock',
      generatedAt: nowIso(),
    };
  }

  function computeDiff(oldText, newText) {
    const oldLines = String(oldText).split('\n');
    const newLines = String(newText).split('\n');
    let added = 0;
    let removed = 0;
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    for (const line of newLines) if (!oldSet.has(line)) added += 1;
    for (const line of oldLines) if (!newSet.has(line)) removed += 1;
    return { added, removed, unchanged: oldLines.length - removed };
  }

  function applyAiCandidate(episodeId, candidate) {
    if (!candidate || !candidate.text) throw httpError('VALIDATION_ERROR', 400, '候选无效');
    const draft = getDraftRow(episodeId);
    if (!draft) throw httpError('NOT_FOUND', 404, '尚无草稿');
    db.prepare('UPDATE episode_script_revisions SET content = ?, updated_at = ? WHERE id = ?').run(
      candidate.text,
      nowIso(),
      draft.id
    );
    try {
      parseScenes(episodeId);
    } catch {
      // 解析失败不影响应用
    }
    return { applied: true, revision: draft.revision };
  }

  function confirmScript(episodeId, { expectedRevision = null } = {}) {
    const episode = requireEpisode(episodeId);
    const draft = getDraftRow(episodeId);
    if (!draft) throw httpError('NOT_FOUND', 404, '尚无草稿可确认');
    if (expectedRevision !== null && expectedRevision !== undefined) {
      if (Number(expectedRevision) !== Number(draft.revision)) {
        throw httpError('REVISION_CONFLICT', 409, '草稿已被其他窗口更新，请刷新比较后重试');
      }
    }
    if (!String(draft.content || '').trim()) {
      throw httpError('EMPTY_SCRIPT', 400, '空剧本不能确认');
    }

    const fingerprint = sha256Text(draft.content);
    stages.ensureStage(episode.drama_id, episodeId, 'script');
    const state = stages.getStage(episodeId, 'script');
    if (state.status !== 'in_progress') {
      // approved/stale/ready 之外不允许直接批准：派生回 in_progress 走统一状态机
      stages.markInProgress(episodeId, 'script', { contentRevision: draft.revision });
    }
    stages.submitReview(episodeId, 'script', { fingerprint });
    const approved = stages.approve(episodeId, 'script', {
      expectedRevision: draft.revision,
      expectedFingerprint: fingerprint,
    });

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE episode_script_revisions SET status = 'superseded', approved_at = NULL
         WHERE episode_id = ? AND status = 'approved' AND id != ?`
      ).run(episodeId, draft.id);
      db.prepare(
        `UPDATE episode_script_revisions SET status = 'approved', approved_at = ?, approved_by = 'local-user', updated_at = ? WHERE id = ?`
      ).run(nowIso(), nowIso(), draft.id);
      // 下游已批准阶段标记 stale（保留旧批准版本）
      for (const downstream of ['assets', 'storyboard', 'cut']) {
        const down = db
          .prepare("SELECT status FROM production_stage_states WHERE episode_id = ? AND stage = ?")
          .get(episodeId, downstream);
        if (down && down.status === 'approved') {
          stages.markStale(episodeId, downstream, { newFingerprint: fingerprint, reason: 'script-changed' });
        }
      }
    });
    tx();
    return { revision: draft.revision, status: approved.status, fingerprint };
  }

  function listHistory(episodeId) {
    return db
      .prepare(
        `SELECT id, revision, status, title, scene_count, word_count, LENGTH(content) AS chars, source, created_at, approved_at
         FROM episode_script_revisions WHERE episode_id = ? ORDER BY revision DESC`
      )
      .all(Number(episodeId));
  }

  function getRevisionContent(episodeId, revision) {
    return db
      .prepare('SELECT * FROM episode_script_revisions WHERE episode_id = ? AND revision = ?')
      .get(Number(episodeId), Number(revision));
  }

  function copyFromHistory(episodeId, revision) {
    const source = getRevisionContent(episodeId, revision);
    if (!source) throw httpError('NOT_FOUND', 404, '历史版本不存在');
    const result = saveDraft(episodeId, { content: source.content, title: source.title });
    return { ...result, content: source.content };
  }

  function getStageModel(episodeId) {
    const episode = requireEpisode(episodeId);
    const draft = getDraftRow(episodeId);
    const approved = getApprovedRow(episodeId);
    return {
      episodeId: Number(episodeId),
      projectId: episode.drama_id,
      draft: draft
        ? { revisionId: draft.id, revision: draft.revision, content: draft.content, title: draft.title, savedAt: draft.updated_at }
        : null,
      approved: approved ? { revision: approved.revision, approvedAt: approved.approved_at } : null,
      scenes: listScenes(episodeId),
      canConfirm: Boolean(draft && String(draft.content || '').trim()),
      hasUnconfirmedChanges: Boolean(approved && draft && draft.content !== approved.content),
      confirmLabel: approved ? '确认修改' : '确认剧本',
      history: listHistory(episodeId),
    };
  }

  return {
    getStageModel,
    saveDraft,
    parseScenes,
    listScenes,
    generateAiCandidate,
    applyAiCandidate,
    confirmScript,
    listHistory,
    getRevisionContent,
    copyFromHistory,
  };
}

module.exports = { createScriptService };
