'use strict';

/**
 * V2.1 任务中心聚合列表（Task 1.6 / P0-2）。
 *
 * 把三类任务来源聚合为统一 TaskCenterItem（items + total，内存分页）：
 * - async_tasks：分镜视频/图片、项目素材生成、自由创作（排除 type='v21:compose'——
 *   成片合成以 episode_cut_versions 为权威行，避免同一合成重复出现两条）。
 * - external_ai_package_tasks：外部 AI 制作包（waiting_external / imported / cancelled）。
 * - episode_cut_versions：整集合成版本（composing / ready→completed / failed / exported；
 *   合片取消把行写成 status='failed' + error_message='cancel-requested'，此处归一为 cancelled）。
 *
 * 状态三页签映射：
 * - in_progress = pending, running, composing, cancel-requested
 * - attention   = failed, waiting_external
 * - done        = completed, cancelled, exported, imported
 */

const TAB_STATUS = {
  in_progress: ['pending', 'running', 'composing', 'cancel-requested'],
  attention: ['failed', 'waiting_external'],
  done: ['completed', 'cancelled', 'exported', 'imported'],
};

const TASK_TYPES = ['image', 'video', 'external', 'compose', 'quick-create'];

// v1 遗留状态别名 → 统一状态
const ASYNC_STATUS_ALIAS = {
  queued: 'pending',
  processing: 'running',
};

function normalizeTime(value) {
  if (!value) return '';
  // datetime('now') 产出 'YYYY-MM-DD HH:MM:SS'（空格分隔），统一成 ISO 形态再比较
  return String(value).replace(' ', 'T');
}

function createTaskCenterService(db, { log = console } = {}) {
  const { ensureExternalAiTaskV21Columns, ensureCutVersionsV21Columns } = require('../db.js');
  ensureExternalAiTaskV21Columns(db);
  ensureCutVersionsV21Columns(db);

  function toInt(value, fallback) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  }

  /** 按 shotId（或疑似 shotId 的 resource_id）反查分镜归属：集、项目、镜头号 */
  function resolveShot(idLike) {
    const n = Number(idLike);
    if (!Number.isInteger(n) || n <= 0) return null;
    const row = db
      .prepare(
        `SELECT s.id AS shot_id, s.storyboard_number, e.id AS episode_id, e.drama_id
         FROM storyboards s JOIN episodes e ON e.id = s.episode_id
         WHERE s.id = ?`
      )
      .get(n);
    if (!row) return null;
    return {
      projectId: row.drama_id,
      episodeId: row.episode_id,
      shotId: row.shot_id,
      stage: 'storyboard',
      number: row.storyboard_number != null ? Number(row.storyboard_number) : null,
    };
  }

  function publicTarget(resolved) {
    if (!resolved) return null;
    return {
      projectId: resolved.projectId,
      episodeId: resolved.episodeId,
      shotId: resolved.shotId,
      stage: resolved.stage,
    };
  }

  function assetName(ownerType, ownerId) {
    const assetType = String(ownerType || '').replace('project_asset_', '');
    const table = { character: 'characters', scene: 'scenes', prop: 'props' }[assetType];
    if (!table) return null;
    const id = Number(ownerId);
    if (!Number.isInteger(id)) return null;
    const row = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id);
    return row && row.name ? row.name : null;
  }

  function asyncItem(row) {
    const ownerType = String(row.owner_type || '');
    const type = String(row.type || '');
    let taskType;
    if (ownerType === 'storyboard_video') taskType = 'video';
    else if (ownerType === 'storyboard_image') taskType = 'image';
    else if (ownerType.startsWith('project_asset_')) taskType = 'image';
    else if (ownerType === 'quick_create') taskType = 'quick-create';
    else if (type.includes('video')) taskType = 'video';
    else if (type.includes('image')) taskType = 'image';
    else if (type.includes('compose')) taskType = 'compose';
    else taskType = 'quick-create';

    let resolved = null;
    let title = '';
    if (ownerType === 'storyboard_video' || ownerType === 'storyboard_image') {
      resolved = resolveShot(row.owner_id) || resolveShot(row.resource_id);
      const label = resolved && resolved.number != null ? resolved.number : row.owner_id;
      title = `镜头 ${label} · ${taskType === 'video' ? '视频生成' : '图片生成'}`;
    } else if (ownerType.startsWith('project_asset_')) {
      const assetTypeLabel = { character: '人物', scene: '场景', prop: '道具' }[ownerType.replace('project_asset_', '')] || '素材';
      const name = assetName(ownerType, row.owner_id);
      title = `项目素材${assetTypeLabel === '素材' ? '' : assetTypeLabel}${name ? `「${name}」` : ` #${row.owner_id}`} · 图片生成`;
    } else if (ownerType === 'quick_create') {
      title = `自由创作 · ${type.includes('video') ? '视频生成' : '图片生成'}`;
    } else {
      // v1 遗留任务（无 owner 归属）：尝试按 resource_id 反查分镜；认不出归 quick-create
      if (taskType === 'video' || taskType === 'image') {
        resolved = resolveShot(row.resource_id);
        title = resolved && resolved.number != null
          ? `镜头 ${resolved.number} · ${taskType === 'video' ? '视频生成' : '图片生成'}`
          : `${taskType === 'video' ? '视频' : '图片'}任务 ${(row.resource_id || row.id).slice(0, 8)}`;
      } else {
        title = `任务 ${(type || String(row.id)).slice(0, 12)}`;
      }
    }

    return {
      id: `v21task:async:${row.id}`,
      source: 'async',
      sourceId: String(row.id),
      taskType,
      title,
      status: ASYNC_STATUS_ALIAS[row.status] || row.status,
      progress: row.progress == null ? null : Number(row.progress),
      statusMessage: row.error || row.message || null,
      costNote: null,
      target: publicTarget(resolved),
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      completedAt: row.completed_at || null,
    };
  }

  function externalItem(row) {
    const status = row.cancelled_at ? 'cancelled' : row.imported_at ? 'imported' : 'waiting_external';
    return {
      id: `v21task:external:${row.package_id}`,
      source: 'external',
      sourceId: String(row.package_id),
      taskType: 'external',
      title: `外部 AI 制作包 · 第 ${row.target_episode_number} 集 · ${String(row.package_id).slice(0, 8)}`,
      status,
      progress: null,
      statusMessage: null,
      costNote: null,
      target: {
        projectId: row.drama_id,
        episodeId: row.target_episode_id || null,
        shotId: null,
        stage: 'episodes',
      },
      createdAt: row.created_at,
      updatedAt: row.cancelled_at || row.imported_at || row.created_at,
      completedAt: row.imported_at || row.cancelled_at || null,
    };
  }

  function composeItem(row) {
    let status;
    if (row.status === 'composing') status = 'composing';
    else if (row.status === 'ready') status = 'completed';
    else if (row.status === 'exported') status = 'exported';
    else status = row.error_message === 'cancel-requested' ? 'cancelled' : 'failed';

    const doneAt = row.updated_at || row.created_at;
    return {
      id: `v21task:compose:${row.id}`,
      source: 'compose',
      sourceId: String(row.id),
      taskType: 'compose',
      title: `成片 v${row.version} · 整集合成`,
      status,
      progress: null,
      statusMessage: row.error_message || null,
      costNote: null,
      target: {
        projectId: row.drama_id,
        episodeId: row.episode_id,
        shotId: null,
        stage: 'cut',
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      completedAt: row.exported_at || (['completed', 'exported', 'cancelled'].includes(status) ? doneAt : null),
    };
  }

  /**
   * 聚合任务列表。
   * @param {object} query - { status?: 'in_progress'|'attention'|'done', type?: 'image,video,...', q?, page?, page_size? }
   * @returns {{ items: object[], total: number, page: number, pageSize: number }}
   */
  function listTasks(query = {}) {
    const statusTab = String(query.status || '');
    const statusSet = TAB_STATUS[statusTab] ? new Set(TAB_STATUS[statusTab]) : null;
    const typeFilter = String(query.type || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => TASK_TYPES.includes(s));
    const typeSet = typeFilter.length ? new Set(typeFilter) : null;
    const q = String(query.q || '').trim().toLowerCase();
    const page = toInt(query.page, 1);
    const pageSize = Math.min(500, toInt(query.page_size, 100));

    let items = [];
    for (const row of db
      .prepare('SELECT * FROM async_tasks WHERE deleted_at IS NULL AND (type IS NULL OR type != ?)')
      .all('v21:compose')) {
      items.push(asyncItem(row));
    }
    for (const row of db.prepare('SELECT * FROM external_ai_package_tasks').all()) {
      items.push(externalItem(row));
    }
    for (const row of db
      .prepare('SELECT v.*, e.drama_id FROM episode_cut_versions v JOIN episodes e ON e.id = v.episode_id')
      .all()) {
      items.push(composeItem(row));
    }

    if (statusSet) items = items.filter((i) => statusSet.has(i.status));
    if (typeSet) items = items.filter((i) => typeSet.has(i.taskType));
    if (q) {
      items = items.filter(
        (i) => i.title.toLowerCase().includes(q) || i.sourceId.toLowerCase().includes(q)
      );
    }

    items.sort((a, b) => normalizeTime(b.updatedAt).localeCompare(normalizeTime(a.updatedAt)));
    const total = items.length;
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total, page, pageSize };
  }

  return { listTasks };
}

module.exports = { createTaskCenterService, TAB_STATUS, TASK_TYPES };
