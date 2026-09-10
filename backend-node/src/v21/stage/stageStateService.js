'use strict';

const STAGES = ['script', 'assets', 'storyboard', 'cut'];

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * V2.1 阶段内容状态机。
 * 状态枚举与转换唯一依据：2026-09-08 状态/Gate 真值表 §3。
 * 任务状态与 Gate 评估不属于本表；任务失败不改变已批准状态。
 */
function createStageStateService(db) {
  function ensureStage(dramaId, episodeId, stage) {
    if (!STAGES.includes(stage)) throw httpError('INVALID_STAGE', 400, `未知阶段: ${stage}`);
    const existing = getStage(episodeId, stage);
    if (existing) return existing;
    db.prepare(
      `INSERT INTO production_stage_states (drama_id, episode_id, stage, status, created_at, updated_at)
       VALUES (?, ?, ?, 'not_started', ?, ?)`
    ).run(dramaId, episodeId, stage, nowIso(), nowIso());
    db.prepare(
      `INSERT INTO production_stage_events (episode_id, stage, event_type, from_status, to_status)
       VALUES (?, ?, 'created', NULL, 'not_started')`
    ).run(episodeId, stage);
    return getStage(episodeId, stage);
  }

  function getStage(episodeId, stage) {
    return db
      .prepare('SELECT * FROM production_stage_states WHERE episode_id = ? AND stage = ?')
      .get(episodeId, stage);
  }

  function listStages(episodeId) {
    const rows = db
      .prepare('SELECT * FROM production_stage_states WHERE episode_id = ?')
      .all(episodeId);
    const byStage = new Map(rows.map((r) => [r.stage, r]));
    return STAGES.map((stage) => byStage.get(stage) || { episode_id: episodeId, stage, status: 'not_started' });
  }

  function writeEvent(episodeId, stage, eventType, from, to, extra = {}) {
    db.prepare(
      `INSERT INTO production_stage_events (episode_id, stage, event_type, from_status, to_status, revision, actor, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      episodeId,
      stage,
      eventType,
      from,
      to,
      extra.revision ?? null,
      extra.actor || 'local-user',
      extra.payload ? JSON.stringify(extra.payload) : null
    );
  }

  function assertExpectedRevision(state, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null) return;
    if (Number(expectedRevision) !== Number(state.content_revision)) {
      throw httpError(
        'REVISION_CONFLICT',
        409,
        `expected_revision ${expectedRevision} 与当前 ${state.content_revision} 不匹配`
      );
    }
  }

  function transition(episodeId, stage, fromStatus, toStatus, eventType, extra = {}) {
    const state = getStage(episodeId, stage);
    if (!state) throw httpError('STAGE_NOT_FOUND', 404, '阶段状态不存在');
    const allowedFrom = Array.isArray(fromStatus) ? fromStatus : fromStatus ? [fromStatus] : null;
    if (allowedFrom && !allowedFrom.includes(state.status)) {
      throw httpError(
        'INVALID_TRANSITION',
        409,
        `阶段 ${stage} 当前为 ${state.status}，不允许 ${eventType}（需要 ${allowedFrom.join('/')}）`
      );
    }
    db.prepare(
      `UPDATE production_stage_states
       SET status = ?, content_revision = ?, source_fingerprint = ?, blocker_json = ?,
           approved_revision = ?, approved_by = ?, approved_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      toStatus,
      extra.contentRevision ?? state.content_revision,
      extra.fingerprint ?? state.source_fingerprint,
      extra.blockers ? JSON.stringify(extra.blockers) : state.blocker_json,
      extra.approvedRevision ?? state.approved_revision,
      extra.approvedBy ?? state.approved_by,
      extra.approvedAt ?? state.approved_at,
      nowIso(),
      state.id
    );
    writeEvent(episodeId, stage, eventType, state.status, toStatus, extra);
    return getStage(episodeId, stage);
  }

  return {
    ensureStage,
    getStage,
    listStages,

    /** not_started|stale --首次保存草稿/派生新 revision--> in_progress */
    markInProgress(episodeId, stage, { contentRevision = null, actor } = {}) {
      const state = getStage(episodeId, stage);
      if (state && !['not_started', 'stale', 'in_progress'].includes(state.status)) {
        throw httpError('INVALID_TRANSITION', 409, `阶段 ${stage} 当前为 ${state.status}，不能开始新草稿`);
      }
      return transition(episodeId, stage, null, 'in_progress', state && state.status === 'stale' ? 'create-revision' : 'first-draft-saved', {
        contentRevision: contentRevision ?? ((state?.content_revision || 0) + 1),
        actor,
      });
    },

    /** in_progress --submit-review--> ready_for_review（无 blocker）；有 blocker 抛 STAGE_BLOCKED */
    submitReview(episodeId, stage, { blockers = [], fingerprint = '' } = {}) {
      if (blockers.length > 0) {
        throw httpError('STAGE_BLOCKED', 409, '存在未解决的 blocker');
      }
      return transition(episodeId, stage, ['in_progress', 'stale'], 'ready_for_review', 'submit-review', {
        fingerprint,
        blockers: [],
      });
    },

    /** ready_for_review --edit--> in_progress（待审快照保留为历史） */
    edit(episodeId, stage, { contentRevision = null } = {}) {
      return transition(episodeId, stage, 'ready_for_review', 'in_progress', 'edit', {
        contentRevision: contentRevision ?? ((getStage(episodeId, stage)?.content_revision || 0) + 1),
      });
    },

    /** ready_for_review --approve--> approved（需要 expected revision/fingerprint 匹配） */
    approve(episodeId, stage, { expectedRevision, expectedFingerprint, actor = 'local-user' } = {}) {
      const state = getStage(episodeId, stage);
      if (!state) throw httpError('STAGE_NOT_FOUND', 404, '阶段状态不存在');
      if (state.status !== 'ready_for_review') {
        throw httpError('INVALID_TRANSITION', 409, `阶段 ${stage} 当前为 ${state.status}，不能批准`);
      }
      assertExpectedRevision(state, expectedRevision);
      if (expectedFingerprint !== undefined && expectedFingerprint !== null) {
        if (String(expectedFingerprint) !== String(state.source_fingerprint)) {
          throw httpError('REVISION_CONFLICT', 409, 'fingerprint 已变化，请刷新后重试');
        }
      }
      const approvedAt = nowIso();
      return transition(episodeId, stage, 'ready_for_review', 'approved', 'approved', {
        approvedRevision: state.content_revision,
        approvedBy: actor,
        approvedAt,
        actor,
      });
    },

    /** ready_for_review --reject--> in_progress（原因必填） */
    reject(episodeId, stage, { reason } = {}) {
      if (!reason || !String(reason).trim()) {
        throw httpError('REASON_REQUIRED', 400, '退回必须填写原因');
      }
      return transition(episodeId, stage, 'ready_for_review', 'in_progress', 'rejected', {
        payload: { reason },
      });
    },

    /** approved --上游依赖 fingerprint 改变--> stale（保留批准 revision 与产物） */
    markStale(episodeId, stage, { newFingerprint = '', reason = 'upstream-changed' } = {}) {
      return transition(episodeId, stage, 'approved', 'stale', 'upstream-changed', {
        fingerprint: newFingerprint,
        payload: { reason },
      });
    },

    /** 无关任务失败：不改变状态，只返回当前状态（供 UI 显示 failed badge） */
    recordUnrelatedTaskFailure(episodeId, stage) {
      writeEvent(episodeId, stage, 'unrelated-task-failed', null, null);
      return getStage(episodeId, stage);
    },

    /** stale 状态低风险预览：保持 stale 并记录事件 */
    keepApprovedForPreview(episodeId, stage) {
      return transition(episodeId, stage, 'stale', 'stale', 'keep-approved-for-preview', {});
    },
  };
}

module.exports = { createStageStateService, STAGES };
