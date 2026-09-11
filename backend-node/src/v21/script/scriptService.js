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

  /** 把正文按场次标题拆成块（场次导航统计与 diff 的共同基础） */
  function splitSceneBlocks(content) {
    const blocks = [];
    let current = null;
    for (const line of String(content || '').split('\n')) {
      const t = line.trim();
      const headingLike = /^(第[一二三四五六七八九十百千0-9]+场|\d{1,3}[.、、])|^((内景|外景)[·\s])/.test(t);
      if (headingLike && t.length <= 40 && t) {
        current = { heading: t.replace(/^第[一二三四五六七八九十百千0-9]+场\s*/, ''), lines: [] };
        blocks.push(current);
      } else if (current && t) {
        current.lines.push(t);
      }
    }
    return blocks;
  }

  /** 场次导航统计：每场字数/内外景/对白数 + 全集合计与建议 */
  function getSceneStats(episodeId) {
    const draft = getDraftRow(episodeId);
    const blocks = splitSceneBlocks(draft ? draft.content : '');
    const scenes = blocks.map((b, i) => {
      const chars = b.lines.join('').length;
      const dialogueCount = b.lines.filter((l) => /^[^：:]{1,12}[：:]/.test(l)).length;
      const ie = /^(内景|内)/.test(b.heading) ? '内景' : /^(外景|外)/.test(b.heading) ? '外景' : '';
      return {
        no: `${i + 1}`,
        heading: b.heading,
        interiorExterior: ie,
        chars,
        dialogueCount,
        suggestion: chars > 400 ? '场次偏长' : dialogueCount >= 4 ? '对白过密' : null,
      };
    });
    const bodyChars = scenes.reduce((s, x) => s + x.chars, 0);
    return {
      scenes,
      totalScenes: scenes.length,
      totalChars: (draft ? draft.content : '').replace(/\s/g, '').length,
      estimatedSeconds: Math.round(bodyChars / 24),
      suggestions: scenes.filter((s) => s.suggestion).map((s) => `场次 ${s.no} ${s.suggestion}`),
    };
  }

  /** 确认前检查 + 预计素材变化 + 下游影响（设计稿 08 右栏 / 18 影响摘要） */
  function getConfirmPreview(episodeId) {
    const draft = getDraftRow(episodeId);
    if (!draft) throw httpError('NOT_FOUND', 404, '尚无草稿');
    const approved = getApprovedRow(episodeId);
    const stats = getSceneStats(episodeId);
    const draftBlocks = splitSceneBlocks(draft.content);
    const approvedBlocks = approved ? splitSceneBlocks(approved.content) : [];
    const approvedHeadings = new Map(approvedBlocks.map((b) => [b.heading, b]));

    const added = draftBlocks.filter((b) => !approvedHeadings.has(b.heading)).length;
    const changed = draftBlocks.filter((b) => {
      const old = approvedHeadings.get(b.heading);
      return old && old.lines.join('\n') !== b.lines.join('\n');
    }).length;
    const removed = approvedBlocks.filter((b) => !draftBlocks.some((d) => d.heading === b.heading)).length;

    const storyboardCount = db
      .prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
      .get(episodeId).n;
    const shotImageCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM image_generations g
         JOIN storyboards sb ON sb.id = g.storyboard_id
         WHERE sb.episode_id = ? AND g.status = 'succeeded' AND g.deleted_at IS NULL`
      )
      .get(episodeId).n;

    return {
      check: {
        scenes: stats.totalScenes,
        chars: stats.totalChars,
        estimatedSeconds: stats.estimatedSeconds,
        blockers: (draft.content || '').trim() ? 0 : 1,
        suggestions: stats.suggestions,
      },
      assetChanges: { added, changed, removed },
      downstream: {
        storyboardPackagesStale: storyboardCount,
        shotImagesKeep: shotImageCount,
      },
      revisionChain: {
        draftRevision: draft.revision,
        nextRevision: approved ? approved.revision + 1 : draft.revision,
        approvedRevision: approved ? approved.revision : null,
      },
    };
  }

  /** 版本比较：场次级行 diff（绿增/红删/同） */
  function getDiff(episodeId, fromRevision, toRevision) {
    const from = getRevisionContent(episodeId, fromRevision);
    const to = getRevisionContent(episodeId, toRevision);
    if (!from || !to) throw httpError('NOT_FOUND', 404, '版本不存在');
    const fromBlocks = splitSceneBlocks(from.content);
    const toBlocks = splitSceneBlocks(to.content);
    const count = Math.max(fromBlocks.length, toBlocks.length);
    const scenes = [];
    for (let i = 0; i < count; i += 1) {
      const a = fromBlocks[i];
      const b = toBlocks[i];
      const oldLines = a ? a.lines : [];
      const newLines = b ? b.lines : [];
      const n = oldLines.length;
      const m = newLines.length;
      const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let x = n - 1; x >= 0; x -= 1) {
        for (let y = m - 1; y >= 0; y -= 1) {
          dp[x][y] = oldLines[x] === newLines[y] ? dp[x + 1][y + 1] + 1 : Math.max(dp[x + 1][y], dp[x][y + 1]);
        }
      }
      const lines = [];
      let x = 0;
      let y = 0;
      while (x < n && y < m) {
        if (oldLines[x] === newLines[y]) {
          lines.push({ type: 'same', text: newLines[y] });
          x += 1;
          y += 1;
        } else if (dp[x + 1][y] >= dp[x][y + 1]) {
          lines.push({ type: 'del', text: oldLines[x] });
          x += 1;
        } else {
          lines.push({ type: 'add', text: newLines[y] });
          y += 1;
        }
      }
      while (x < n) { lines.push({ type: 'del', text: oldLines[x] }); x += 1; }
      while (y < m) { lines.push({ type: 'add', text: newLines[y] }); y += 1; }
      scenes.push({
        no: i + 1,
        heading: (b || a || {}).heading || '',
        status: !a ? 'added' : !b ? 'removed' : lines.some((l) => l.type !== 'same') ? 'changed' : 'same',
        lines,
      });
    }
    return {
      fromRevision,
      toRevision,
      scenes,
      summary: {
        changed: scenes.filter((s) => s.status === 'changed').length,
        added: scenes.filter((s) => s.status === 'added').length,
        removed: scenes.filter((s) => s.status === 'removed').length,
      },
    };
  }

  /** 阶段导航 meta（设计稿 stagenav：每阶段序号+名+状态副文本+warn 徽标） */
  function getStageNav(episodeId) {
    const episode = requireEpisode(episodeId);
    const draft = getDraftRow(episodeId);
    const approved = getApprovedRow(episodeId);
    const { createStageStateService } = require('../stage/stageStateService.js');
    const stages = createStageStateService(db);
    stages.ensureStage(episode.drama_id, episodeId, 'script');
    const states = ['script', 'assets', 'storyboard', 'cut'].map((st) => stages.getStage(episodeId, st));

    const totalShots = db
      .prepare('SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL')
      .get(episodeId).n;
    const adoptedShots = db
      .prepare(
        `SELECT COUNT(*) AS n FROM director_candidate_groups g
         JOIN storyboards sb ON CAST(g.shot_id AS INTEGER) = sb.id
         WHERE sb.episode_id = ? AND sb.deleted_at IS NULL AND g.selected_candidate_id IS NOT NULL`
      )
      .get(episodeId).n;
    const assetsReady = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM episode_characters ec JOIN characters c ON c.id = ec.character_id
             WHERE ec.episode_id = ? AND c.deleted_at IS NULL AND c.image_url IS NOT NULL AND c.image_url != '') +
           (SELECT COUNT(*) FROM scenes WHERE episode_id = ? AND deleted_at IS NULL AND image_url IS NOT NULL AND image_url != '') AS ready,
           (SELECT COUNT(*) FROM episode_characters ec JOIN characters c ON c.id = ec.character_id
             WHERE ec.episode_id = ? AND c.deleted_at IS NULL) +
           (SELECT COUNT(*) FROM scenes WHERE episode_id = ? AND deleted_at IS NULL) AS total`
      )
      .get(episodeId, episodeId, episodeId, episodeId);
    const cutVersion = db
      .prepare('SELECT version FROM episode_cut_versions WHERE episode_id = ? ORDER BY version DESC LIMIT 1')
      .get(episodeId);

    const scriptMeta = [];
    if (draft) scriptMeta.push(`草稿 v${draft.revision}`);
    if (approved) scriptMeta.push(`已确认 v${approved.revision}`);
    if (scriptMeta.length === 0) scriptMeta.push('未开始');

    const percent = Math.round(
      states.reduce((sum, s) => {
        const st = s ? s.status : 'not_started';
        return sum + ({ not_started: 0, in_progress: 40, ready_for_review: 75, approved: 100, stale: 60 }[st] || 0);
      }, 0) / states.length
    );

    return {
      stages: [
        { id: 'script', idx: 1, label: '剧本', meta: scriptMeta.join(' · '), warn: 0 },
        {
          id: 'assets', idx: 2, label: '设定',
          meta: assetsReady.total > 0 ? `${assetsReady.ready}/${assetsReady.total} 已确认` : '未开始',
          warn: 0,
        },
        {
          id: 'storyboard', idx: 3, label: '分镜',
          meta: totalShots > 0 ? `${adoptedShots}/${totalShots} 已采用` : '未开始',
          warn: Math.max(0, totalShots - adoptedShots),
        },
        { id: 'cut', idx: 4, label: '成片', meta: cutVersion ? `成片 v${cutVersion.version}` : '未开始', warn: 0 },
      ],
      completionPercent: percent,
      basedOnApprovedRevision: approved ? approved.revision : null,
    };
  }

  return {
    getStageModel,
    getStageNav,
    getSceneStats,
    getConfirmPreview,
    getDiff,
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
