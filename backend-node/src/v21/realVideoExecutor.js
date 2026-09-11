'use strict';
/**
 * V2.1 真实视频执行器（A1）：委托统一视频生成服务（MiniMax H3 / ComfyUI / 各云协议），
 * 候选仍写 director 三表（groups/candidates/artifacts），采用合同与 mock 通道一致。
 * - submit：每个候选一条 video_generations + async_tasks（回写 V2.1 归属字段）+ director_candidates 占位
 * - waitForTask：轮询 video_generations 终态，经 candidateGroupService 产出 artifact
 * - cancel / retry：走统一服务的取消/重试语义，async_tasks 保留记录（cancel-requested）
 * 测试可注入 videoGenerationService 替身（不发真实请求）。
 */
const { getSharedVideoRuntime } = require('../services/videoGenerationRuntime.js');
const candidateService = require('../director/candidateGroupService.js');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorMessage(raw) {
  const text = String(raw || '').trim();
  if (!text) return '视频生成失败';
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error || text;
  } catch (_) {
    return text;
  }
}

function createRealVideoExecutor({
  db,
  cfg = {},
  log = console,
  storageRoot = null,
  videoGenerationService = null,
  pollIntervalMs = 1500,
  waitTimeoutMs = 15 * 60 * 1000,
} = {}) {
  let svcInstance = videoGenerationService || null;

  function svc() {
    if (!svcInstance) {
      svcInstance = getSharedVideoRuntime({ db, cfg, log }).unifiedService;
    }
    return svcInstance;
  }

  function linkAsyncTaskToShot(taskId, { shotId, videoGenerationId, prompt }) {
    db.prepare(
      `UPDATE async_tasks SET owner_type = 'storyboard_video', owner_id = ?, input_json = ?, updated_at = ? WHERE id = ?`
    ).run(
      String(shotId),
      JSON.stringify({ videoGenerationId, shotId, prompt: prompt || '', channel: 'real' }),
      new Date().toISOString(),
      taskId
    );
  }

  function insertPendingCandidate({ taskId, groupId, videoGenerationId }) {
    const candidateId = `cand_${taskId}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO director_candidates (id, group_id, artifact_id, job_id, video_generation_id, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 'pending', ?, ?)`
    ).run(candidateId, groupId, `pending-video-${candidateId}`, videoGenerationId, now, now);
    return candidateId;
  }

  function genByTaskId(taskId) {
    const task = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
    if (!task) throw httpError('NOT_FOUND', 404, `任务不存在: ${taskId}`);
    let videoGenerationId = null;
    try {
      videoGenerationId = task.input_json ? (JSON.parse(task.input_json).videoGenerationId ?? null) : null;
    } catch (_) {
      videoGenerationId = null;
    }
    if (videoGenerationId == null) {
      const byTask = db.prepare('SELECT id FROM video_generations WHERE task_id = ?').get(taskId);
      videoGenerationId = byTask ? byTask.id : null;
    }
    if (videoGenerationId == null) throw httpError('NOT_FOUND', 404, '任务缺少视频生成关联');
    const gen = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(Number(videoGenerationId));
    if (!gen) throw httpError('NOT_FOUND', 404, '视频生成记录不存在');
    return { task, gen };
  }

  async function submit({ shotId, dramaId, count = 1, prompt = '', duration = null, referenceUrls = [], h3PromptDraftId = null, groupId, resolved, channelOptions } = {}) {
    if (!groupId) throw httpError('VALIDATION_ERROR', 400, '缺少候选组');
    const tasks = [];
    for (let i = 0; i < Number(count) || 0; i += 1) {
      const gen = await svc().createVideoGeneration({
        drama_id: Number(dramaId) || undefined,
        storyboard_id: Number(shotId),
        prompt: prompt || undefined,
        duration: duration == null ? undefined : Number(duration),
        reference_image_urls: referenceUrls && referenceUrls.length ? referenceUrls : undefined,
        candidate_group_id: groupId,
        h3_prompt_draft_id: h3PromptDraftId == null ? undefined : Number(h3PromptDraftId),
        workflow_id: resolved && resolved.model ? resolved.model : undefined,
      });
      linkAsyncTaskToShot(gen.task_id, { shotId, videoGenerationId: gen.id, prompt });
      const candidateId = insertPendingCandidate({ taskId: gen.task_id, groupId, videoGenerationId: gen.id });
      tasks.push({ taskId: gen.task_id, videoGenerationId: gen.id, candidateId, deduped: false });
    }
    return { tasks };
  }

  function terminalView(gen) {
    if (['review', 'completed', 'selected'].includes(gen.status)) {
      candidateService.syncUnifiedCandidateGroup(db, gen.candidate_group_id, { storageRoot });
      const candidate = db
        .prepare('SELECT * FROM director_candidates WHERE video_generation_id = ? ORDER BY id DESC LIMIT 1')
        .get(Number(gen.id));
      if (!candidate) throw httpError('VIDEO_GENERATION_FAILED', 502, '视频候选缺失');
      const artifact = candidate.artifact_id
        ? db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(candidate.artifact_id)
        : null;
      return {
        done: true,
        ok: true,
        candidateId: candidate.id,
        artifactId: artifact ? artifact.id : null,
        group: gen.candidate_group_id,
        url: gen.video_url || null,
        localPath: gen.local_path || null,
      };
    }
    if (['failed', 'cancelled', 'interrupted'].includes(gen.status)) {
      return { done: true, ok: false, error: parseErrorMessage(gen.error_msg) };
    }
    return { done: false, ok: null };
  }

  async function waitForTask(taskId) {
    const deadline = Date.now() + waitTimeoutMs;
    for (;;) {
      const { gen } = genByTaskId(taskId);
      const view = terminalView(gen);
      if (view.done) {
        if (!view.ok) throw httpError('VIDEO_GENERATION_FAILED', 502, view.error);
        return view;
      }
      if (Date.now() > deadline) {
        throw httpError('VIDEO_GENERATION_TIMEOUT', 504, '视频生成等待超时，请稍后在生成历史查看结果');
      }
      await sleep(pollIntervalMs);
    }
  }

  /** 非阻塞状态视图（供任务轮询端点使用） */
  function status(taskId) {
    const { task, gen } = genByTaskId(taskId);
    const view = terminalView(gen);
    return {
      taskId,
      status: task.status,
      progress: task.progress ?? 0,
      message: task.message || '',
      videoGenerationId: gen.id,
      videoStatus: gen.status,
      done: view.done,
      ok: view.ok,
      result: view.done && view.ok
        ? { candidateId: view.candidateId, artifactId: view.artifactId, group: view.group, url: view.url }
        : null,
      error: view.done && !view.ok ? view.error : null,
    };
  }

  async function cancel(taskId) {
    const { gen } = genByTaskId(taskId);
    if (['review', 'completed', 'selected'].includes(gen.status)) {
      throw httpError('TASK_NOT_CANCELLABLE', 409, '已完成任务不能取消');
    }
    try {
      await svc().cancelVideoGeneration(Number(gen.id));
    } catch (err) {
      // 统一服务对已终态任务抛 409；本地记录仍按 cancel-requested 收口
      if (!/不可取消|NOT_CANCELLABLE/i.test(String(err && err.message))) throw err;
    }
    db.prepare(
      `UPDATE async_tasks SET status = 'cancelled', message = 'cancel-requested：用户取消', cancel_state = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), new Date().toISOString(), taskId);
    return { taskId, cancelState: 'cancelled', recordRetained: true };
  }

  async function retry(taskId) {
    const { gen } = genByTaskId(taskId);
    await svc().retryVideoGeneration(Number(gen.id));
    const refreshed = db.prepare('SELECT * FROM video_generations WHERE id = ?').get(Number(gen.id));
    linkAsyncTaskToShot(refreshed.task_id, {
      shotId: refreshed.storyboard_id,
      videoGenerationId: refreshed.id,
      prompt: refreshed.prompt,
    });
    insertPendingCandidate({ taskId: refreshed.task_id, groupId: refreshed.candidate_group_id, videoGenerationId: refreshed.id });
    return { taskId: refreshed.task_id, videoGenerationId: refreshed.id };
  }

  return { submit, waitForTask, status, cancel, retry };
}

module.exports = { createRealVideoExecutor };
