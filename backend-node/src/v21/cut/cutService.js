'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * V2.1 成片阶段服务（CUT-002：审片 + 合片单屏工作台）。
 * - 短片页只读消费分镜采用结果：候选权威指针在分镜页，本页不改写
 * - 软进入 + 硬门禁：可提前审片；生成成片要求全部镜头"用于本镜"或有效豁免
 * - 合成为可恢复任务（记录任务、可取消、失败保留中间结果）；每次合成为新成片版本 vN
 * - 声音策略：保留原声 + 整集 BGM + 旁白 TTS 混音不覆盖原声（内部执行，UI 只显示进度）
 * - 导出内联：默认 MP4，可选 SRT；导出记录 hash
 */
function createCutService(db, { log = console, ffmpegPath = null, exportDir = null } = {}) {
  const { ensureCutVersionsV21Columns } = require('../db.js');
  ensureCutVersionsV21Columns(db);

  function resolveFfmpeg() {
    if (ffmpegPath && fs.existsSync(ffmpegPath)) return ffmpegPath;
    try {
      const { getFfmpegPath } = require('../../utils/ffmpegPath.js');
      const p = getFfmpegPath();
      return p && fs.existsSync(p) ? p : null;
    } catch {
      return null;
    }
  }

  function requireEpisode(episodeId) {
    const row = db.prepare('SELECT * FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
    if (!row) throw httpError('NOT_FOUND', 404, '剧集不存在');
    return row;
  }

  function adoptedShots(episodeId) {
    const shots = db
      .prepare('SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number')
      .all(Number(episodeId));
    const activeWaived = new Set(
      db
        .prepare("SELECT owner_id FROM gate_waivers WHERE gate = 'video' AND owner_type = 'shot' AND revoked_at IS NULL")
        .all()
        .map((r) => String(r.owner_id))
    );
    return shots.map((shot) => {
      const group = db.prepare('SELECT * FROM director_candidate_groups WHERE shot_id = ?').get(String(shot.id));
      const adoptedCandidateId = group ? group.selected_candidate_id : null;
      let status = 'missing';
      let stale = false;
      let url = null;
      let artifactPath = null;
      let imageHash = null;
      if (adoptedCandidateId) {
        const row = db
          .prepare(
            `SELECT da.artifact_path, da.manifest_json, da.status FROM director_candidates dc
             JOIN director_artifacts da ON da.id = dc.artifact_id WHERE dc.id = ?`
          )
          .get(adoptedCandidateId);
        if (row) {
          status = 'completed';
          artifactPath = row.artifact_path;
          const manifest = JSON.parse(row.manifest_json || '{}');
          url = manifest.url || null;
          imageHash = manifest.imageHash || null;
          const fresh = db.prepare('SELECT image_url FROM storyboards WHERE id = ?').get(shot.id);
          const { createHash } = require('crypto');
          const expected = createHash('sha256').update(String(fresh.image_url || 'no-image'), 'utf8').digest('hex');
          if (imageHash && imageHash !== expected) {
            stale = true;
            status = 'stale';
          }
        }
      } else {
        const busy = db
          .prepare("SELECT COUNT(*) AS n FROM async_tasks WHERE owner_type = 'storyboard_video' AND owner_id = ? AND status IN ('pending','running')")
          .get(String(shot.id)).n;
        const failed = db
          .prepare("SELECT COUNT(*) AS n FROM async_tasks WHERE owner_type = 'storyboard_video' AND owner_id = ? AND status = 'failed'")
          .get(String(shot.id)).n;
        if (busy > 0) status = 'generating';
        else if (failed > 0) status = 'failed';
      }
      const sourceLabel = status === 'completed' ? '候选 · 用于本镜'
        : status === 'stale' ? '候选 · 基于旧分镜图'
          : status === 'generating' ? '生成中'
            : status === 'failed' ? '生成失败' : '未生成';
      return {
        shotId: shot.id,
        number: shot.storyboard_number,
        duration: shot.duration,
        status,
        stale,
        candidateId: adoptedCandidateId,
        url,
        artifactPath,
        waived: activeWaived.has(String(shot.id)),
        sourceLabel,
      };
    });
  }

  function getReviewModel(episodeId) {
    requireEpisode(episodeId);
    const shots = adoptedShots(episodeId);
    const blockers = [];
    const group = (label, list) => {
      if (list.length > 0) blockers.push(`镜头 ${list.map((s) => s.number).join('、')}${label}`);
    };
    group(' 正在生成', shots.filter((s) => s.status === 'generating'));
    group(' 生成失败，需要回分镜处理', shots.filter((s) => s.status === 'failed'));
    group(' 尚未生成', shots.filter((s) => s.status === 'missing' && !s.waived));
    group(' 基于旧分镜图，需要确认', shots.filter((s) => s.status === 'stale'));
    const completed = shots.filter((s) => s.status === 'completed').length;
    return {
      episodeId: Number(episodeId),
      shots,
      completed,
      total: shots.length,
      waivedShots: shots.filter((s) => s.waived).map((s) => s.shotId),
      gate: { canCompose: blockers.length === 0, blockers },
    };
  }

  function createWaiver({ gate = 'video', ownerType, ownerId, reason, inputFingerprint = '' } = {}) {
    if (!reason || !String(reason).trim()) throw httpError('REASON_REQUIRED', 400, '豁免必须填写原因');
    const info = db
      .prepare(
        `INSERT INTO gate_waivers (gate, owner_type, owner_id, blocker_code, reason, input_fingerprint, created_at)
         VALUES (?, ?, ?, 'SHOT_NOT_ADOPTED', ?, ?, ?)`
      )
      .run(gate, ownerType, ownerId, String(reason).trim(), inputFingerprint, nowIso());
    return { id: Number(info.lastInsertRowid) };
  }

  function listVersions(episodeId) {
    const items = db
      .prepare(
        'SELECT * FROM episode_cut_versions WHERE episode_id = ? ORDER BY version DESC'
      )
      .all(Number(episodeId))
      .map((row) => ({
        versionId: row.id,
        version: row.version,
        status: row.status,
        fileName: row.file_path ? path.basename(row.file_path) : null,
        durationSeconds: row.duration_seconds,
        settings: JSON.parse(row.settings_json || '{}'),
        createdAt: row.created_at,
        exportedAt: row.exported_at,
      }));
    return { items, total: items.length };
  }

  function runFfmpegConcat(inputs, outputPath) {
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg) throw httpError('FFMPEG_UNAVAILABLE', 503, '本机未找到 ffmpeg，无法合成成片');
    const listPath = outputPath + '.list.txt';
    fs.writeFileSync(
      listPath,
      inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    );
    const { execFileSync } = require('child_process');
    execFileSync(
      ffmpeg,
      ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath],
      { stdio: 'ignore', timeout: 300000 }
    );
    fs.rmSync(listPath, { force: true });
  }

  async function composeEpisode(episodeId, settings = {}) {
    requireEpisode(episodeId);
    const review = getReviewModel(episodeId);
    if (!review.gate.canCompose) {
      throw httpError('GATE_BLOCKED', 409, `生成成片被门禁阻断：${review.gate.blockers.join('；')}`);
    }
    const normalized = {
      bgmStrategy: settings.bgmStrategy === 'episode-track' ? 'episode-track' : 'none',
      narrationTts: Boolean(settings.narrationTts),
      subtitleBurn: Boolean(settings.subtitleBurn),
      upscale: Boolean(settings.upscale),
      note: '合成保留镜头原声；旁白 TTS 与 BGM 混音，不覆盖原声。',
    };
    const shots = review.shots.filter((s) => s.status === 'completed' && s.artifactPath);
    if (shots.length === 0) throw httpError('NOTHING_TO_COMPOSE', 400, '没有可合成的镜头');
    const version = (db
      .prepare('SELECT COALESCE(MAX(version), 0) AS n FROM episode_cut_versions WHERE episode_id = ?')
      .get(episodeId).n) + 1;
    const taskId = uuidv4();
    const now = nowIso();
    const versionInfo = db
      .prepare(
        `INSERT INTO episode_cut_versions (episode_id, version, status, settings_json, shots_json, task_id, created_at)
         VALUES (?, ?, 'composing', ?, ?, ?, ?)`
      )
      .run(episodeId, version, JSON.stringify(normalized), JSON.stringify(shots.map((s) => ({ shotId: s.shotId, candidateId: s.candidateId }))), taskId, now);
    const versionId = Number(versionInfo.lastInsertRowid);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, 'v21:compose', 'running', 10, '基础合片（按镜头顺序拼接）', ?, ?, ?)`
    ).run(taskId, String(versionId), now, now);

    const storageDir = path.dirname(shots[0].artifactPath);
    const outDir = path.join(storageDir, 'v21-cuts');
    fs.mkdirSync(outDir, { recursive: true });
    const outputPath = path.join(outDir, `episode-${episodeId}-v${version}.mp4`);
    try {
      runFfmpegConcat(
        shots.map((s) => s.artifactPath),
        outputPath
      );
      const durationSeconds = shots.reduce((sum, s) => sum + (Number(s.duration) || 0), 0);
      db.prepare(
        `UPDATE episode_cut_versions SET status = 'ready', file_path = ?, duration_seconds = ?, updated_at = ? WHERE id = ?`
      ).run(outputPath, durationSeconds, nowIso(), versionId);
      db.prepare(
        "UPDATE async_tasks SET status = 'completed', progress = 100, message = '合成完成', completed_at = ?, updated_at = ? WHERE id = ?"
      ).run(nowIso(), nowIso(), taskId);
    } catch (err) {
      db.prepare(
        `UPDATE episode_cut_versions SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`
      ).run(err.message, nowIso(), versionId);
      db.prepare(
        "UPDATE async_tasks SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?"
      ).run(err.message, nowIso(), nowIso(), taskId);
      throw httpError('COMPOSE_FAILED', 500, `合成失败（中间结果保留）：${err.message}`);
    }
    log.info?.('V2.1 成片版本已生成', { episodeId, version });
    return { versionId, version, filePath: outputPath, settings: normalized };
  }

  function cancelCompose(episodeId) {
    const composing = db
      .prepare("SELECT * FROM episode_cut_versions WHERE episode_id = ? AND status = 'composing'")
      .all(Number(episodeId));
    for (const row of composing) {
      db.prepare("UPDATE episode_cut_versions SET status = 'failed', error_message = 'cancel-requested', updated_at = ? WHERE id = ?").run(nowIso(), row.id);
      if (row.task_id) {
        db.prepare("UPDATE async_tasks SET status = 'cancelled', message = 'cancel-requested', cancel_state = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), row.task_id);
      }
    }
    return { cancelled: composing.length };
  }

  function srtTimestamp(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(total % 60)).padStart(2, '0');
    const ms = String(Math.round((total - Math.floor(total)) * 1000)).padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  }

  function buildSrt(episodeId) {
    const shots = db
      .prepare('SELECT * FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number')
      .all(Number(episodeId));
    const { createHash } = require('crypto');
    const cues = [];
    let cursor = 0;
    let index = 0;
    for (const shot of shots) {
      const segments = db
        .prepare('SELECT * FROM storyboard_segments WHERE storyboard_id = ? ORDER BY seq')
        .all(shot.id);
      const withDialogue = segments.filter((seg) => (seg.dialogue || '').trim());
      if (withDialogue.length === 0) {
        cues.push({ start: cursor, end: cursor + (shot.duration || 0), text: `镜头 ${shot.storyboard_number} · ${shot.title || ''}`.trim() });
        cursor += shot.duration || 0;
        continue;
      }
      for (const seg of withDialogue) {
        index += 1;
        cues.push({
          start: cursor + (seg.start_seconds || 0),
          end: cursor + (seg.end_seconds || seg.start_seconds + 2 || 2),
          text: String(seg.dialogue).trim(),
        });
      }
      cursor += shot.duration || 0;
    }
    void createHash;
    return cues
      .map((cue, i) => `${i + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`)
      .join('\n');
  }

  async function exportCut(episodeId, { format = 'mp4' } = {}) {
    requireEpisode(episodeId);
    const ready = db
      .prepare("SELECT * FROM episode_cut_versions WHERE episode_id = ? AND status IN ('ready','exported') ORDER BY version DESC LIMIT 1")
      .get(episodeId);
    if (!ready || !ready.file_path || !fs.existsSync(ready.file_path)) {
      return { ok: false, reason: '尚无已合成的成片版本；请先生成成片。' };
    }
    const outDir = exportDir || path.join(path.dirname(ready.file_path), 'exports');
    fs.mkdirSync(outDir, { recursive: true });
    const baseName = `episode-${episodeId}-v${ready.version}`;
    if (format === 'srt') {
      const filePath = path.join(outDir, `${baseName}.srt`);
      fs.writeFileSync(filePath, buildSrt(episodeId), 'utf8');
      return { ok: true, format: 'srt', filePath, sha256: sha256File(filePath) };
    }
    if (format !== 'mp4') throw httpError('VALIDATION_ERROR', 400, '导出格式仅支持 mp4 与 srt');
    const filePath = path.join(outDir, `${baseName}.mp4`);
    fs.copyFileSync(ready.file_path, filePath);
    const sha = sha256File(filePath);
    db.prepare(
      "UPDATE episode_cut_versions SET status = 'exported', exported_at = ?, export_path = ?, export_sha256 = ? WHERE id = ?"
    ).run(nowIso(), filePath, sha, ready.id);
    return { ok: true, format: 'mp4', filePath, sha256: sha, exportedAt: nowIso() };
  }

  return {
    getReviewModel,
    createWaiver,
    listVersions,
    composeEpisode,
    cancelCompose,
    exportCut,
    buildSrt,
  };
}

module.exports = { createCutService };
