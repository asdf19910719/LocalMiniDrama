'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_FFMPEG = () => {
  try {
    const { getFfmpegPath } = require('../utils/ffmpegPath.js');
    return getFfmpegPath();
  } catch {
    return null;
  }
};

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * V2.1 确定性 mock 生成通道（Provider Adapter 领域边界内）。
 * 用途：未配置任何 AI Provider Key 时保证"无 Key 可运行"（铁律 6），以及集成测试的确定性执行。
 * 任务契约与真实 Provider 对齐：queued→running→succeeded/failed/cancelled、
 * 不可变输入快照、费用快照、幂等键去重、取消保留记录、重试创建新 attempt。
 * 产物为真实媒体文件：图片用 sharp 生成 PNG；视频用本机 ffmpeg 生成 MP4。
 */
function createMockProvider({ db, log = console, storageDir, ffmpegPath } = {}) {
  const resolveFfmpeg =
    typeof ffmpegPath === 'function'
      ? ffmpegPath
      : ffmpegPath
        ? () => ffmpegPath
        : DEFAULT_FFMPEG;

  function rowToTask(row) {
    if (!row) return null;
    return {
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      message: row.message,
      resourceId: row.resource_id,
      ownerId: row.owner_id,
      ownerType: row.owner_type,
      input: row.input_json ? JSON.parse(row.input_json) : null,
      cost: row.cost_json ? JSON.parse(row.cost_json) : null,
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  function getTask(taskId) {
    const row = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get(taskId);
    return rowToTask(row);
  }

  function submit({ kind, ownerType = '', ownerId = '', input = {}, cost = null, idempotencyKey = null }) {
    if (!['image', 'video'].includes(kind)) throw new Error(`mock 通道不支持类型: ${kind}`);
    if (idempotencyKey) {
      const existing = db
        .prepare('SELECT * FROM async_tasks WHERE idempotency_key = ?')
        .get(idempotencyKey);
      if (existing) {
        return { taskId: existing.id, deduped: true, status: existing.status };
      }
    }
    const taskId = uuidv4();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks
        (id, type, status, progress, message, resource_id, created_at, updated_at,
         input_json, cost_json, owner_type, owner_id, idempotency_key)
       VALUES (?, ?, 'pending', 0, '排队中', '', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      `v21:mock-${kind}`,
      now,
      now,
      JSON.stringify(input),
      JSON.stringify(
        cost || { estimated: 0, currency: 'local', note: 'mock 本地执行，不产生 API 费用' }
      ),
      ownerType,
      String(ownerId),
      idempotencyKey
    );
    log.info?.('V2.1 mock 任务已创建', { taskId, kind });
    return { taskId, deduped: false, status: 'pending' };
  }

  function mark(taskId, status, progress, message, extra = {}) {
    db.prepare(
      `UPDATE async_tasks
       SET status = ?, progress = ?, message = ?, updated_at = ?,
           cancel_state = COALESCE(?, cancel_state),
           completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN ? ELSE completed_at END,
           result = COALESCE(?, result)
       WHERE id = ?`
    ).run(
      status,
      progress ?? 0,
      message || '',
      new Date().toISOString(),
      extra.cancelState || null,
      status,
      new Date().toISOString(),
      extra.result || null,
      taskId
    );
  }

  async function generateImageArtifact(taskId, input) {
    const dir = path.join(storageDir, 'v21-mock');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${taskId}.png`);
    const seedHex = crypto
      .createHash('sha256')
      .update(input.prompt || taskId)
      .digest('hex');
    const r = parseInt(seedHex.slice(0, 2), 16);
    const g = parseInt(seedHex.slice(2, 4), 16);
    const b = parseInt(seedHex.slice(4, 6), 16);
    const [width, height] = String(input.size || '720x480')
      .split('x')
      .map((n) => Math.max(8, parseInt(n, 10) || 0));
    // 确定性渐变：同一 prompt 恒定产出同一图像
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
        `<stop offset="0" stop-color="rgb(${r},${g},${b})"/>` +
        `<stop offset="1" stop-color="rgb(${b},${r},${g})"/>` +
        `</linearGradient></defs>` +
        `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
        `<text x="24" y="${Math.max(24, height - 24)}" font-size="20" fill="#ffffff">MOCK · ${taskId.slice(0, 8)}</text>` +
        `</svg>`
    );
    await require('sharp')(svg).png().toFile(filePath);
    return filePath;
  }

  function generateVideoArtifact(taskId, input) {
    const dir = path.join(storageDir, 'v21-mock');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${taskId}.mp4`);
    const ffmpeg = resolveFfmpeg();
    const duration = Math.min(10, Math.max(0.5, Number(input.durationSeconds) || 1));
    if (ffmpeg && fs.existsSync(ffmpeg)) {
      const { execFileSync } = require('child_process');
      execFileSync(
        ffmpeg,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          `color=c=0x224466:s=640x360:d=${duration}:r=12`,
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          filePath,
        ],
        { stdio: 'ignore', timeout: 60000 }
      );
    } else {
      // 无 ffmpeg 时写入带 MP4 头的占位文件（声明降级，不伪造编码成功）
      fs.writeFileSync(filePath, Buffer.from('\x00\x00\x00\x18ftypmp42', 'binary'));
      mark(taskId, 'running', 60, 'mock 降级：本机无 ffmpeg，输出占位媒体');
    }
    return { filePath, durationSeconds: duration, degraded: !ffmpeg };
  }

  async function run(taskId) {
    const task = getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    if (['cancelled', 'completed'].includes(task.status)) {
      throw new Error(`任务 ${taskId} 状态为 ${task.status}，不能执行`);
    }
    mark(taskId, 'running', 20, 'mock 通道生成中');
    // C3：可选延迟（GUI 演示运行态/异步轮询演示）；上限 30s，默认 0 不影响测试与正常使用
    const delayMs = Math.min(30000, Math.max(0, Number(task.input?.delayMs) || 0));
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const kind = task.type === 'v21:mock-video' ? 'video' : 'image';
    let artifactPath;
    let extra = { channel: 'mock' };
    if (kind === 'image') {
      artifactPath = await generateImageArtifact(taskId, task.input || {});
    } else {
      const out = generateVideoArtifact(taskId, task.input || {});
      artifactPath = out.filePath;
      extra = { channel: 'mock', durationSeconds: out.durationSeconds, degraded: out.degraded };
    }
    const result = {
      ...extra,
      artifactPath,
      url: `/static/v21-mock/${path.basename(artifactPath)}`,
      sha256: sha256File(artifactPath),
      bytes: fs.statSync(artifactPath).size,
      completedAt: new Date().toISOString(),
    };
    mark(taskId, 'completed', 100, '生成完成', { result: JSON.stringify(result) });
    return result;
  }

  function cancel(taskId, reason = '') {
    const task = getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    if (task.status === 'completed') throw new Error('已完成任务不能取消');
    // cancel-requested 语义：立即标记 cancelled 但保留记录与输入快照
    mark(taskId, 'cancelled', task.progress || 0, `cancel-requested${reason ? '：' + reason : ''}`, {
      cancelState: 'cancelled',
    });
    return { taskId, cancelState: 'cancelled', recordRetained: true };
  }

  /** 按原输入快照创建新 attempt：不复用旧记录，幂等键清空以允许再次执行 */
  function retry(taskId) {
    const task = getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);
    if (!['failed', 'cancelled'].includes(task.status)) {
      throw new Error(`仅失败或已取消任务可重试（当前 ${task.status}）`);
    }
    return submit({
      kind: task.type === 'v21:mock-video' ? 'video' : 'image',
      ownerType: task.ownerType,
      ownerId: task.ownerId,
      input: task.input,
      cost: task.cost,
      idempotencyKey: null,
    });
  }

  return { submit, run, cancel, retry, getTask };
}

module.exports = { createMockProvider };
