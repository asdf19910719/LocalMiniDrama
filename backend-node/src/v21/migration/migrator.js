'use strict';
const fs = require('fs');
const path = require('path');
const { createMigrationJournal } = require('../backup/migrationJournal.js');
const { createBackup, verifyBackup, sha256File } = require('../backup/backupService.js');
const {
  ensureV21Domain,
  ensureAsyncTaskV21Columns,
  ensureExternalAiTaskV21Columns,
  ensureStoryboardV21Columns,
  ensureCutVersionsV21Columns,
} = require('../db.js');

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

/**
 * V2.1 一次性迁移器（迁移矩阵 §2）。
 * 流程：journal PRECHECK →（活动任务冻结预检）→ BACKED_UP（SQLite 备份 + manifest/hash）
 *   → MIGRATING（单事务迁移数据 + 写 app_schema_version=2.1.0）
 *   → VERIFYING（计数/引用对账）→ COMMITTED；任一步失败：journal FAILED + 从备份恢复，禁止半迁移运行态。
 * 只在副本/测试库上演练通过后才允许对正式库执行（Phase 6）。
 */
function runV21Migration({ dbPath, dataDir, log = console, injectFailureAt = null } = {}) {
  const journal = createMigrationJournal(dataDir);
  const migrationId = `v21_${Date.now().toString(36)}`;

  // 幂等：已 COMMITTED 直接退出
  if (journal.isCommitted() && journal.isConsistentWith(readSchemaVersion(dbPath))) {
    return { committed: true, skipped: true, migrationId: journal.read().migrationId };
  }
  journal.assertFreshStart();

  const Database = require('better-sqlite3');
  let db = null;
  try {
    // ---- PRECHECK：任务冻结 ----
    journal.update({ status: 'PRECHECK', migrationId, sourceVersion: readSchemaVersion(dbPath) });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    const activeTasks = db
      .prepare("SELECT COUNT(*) AS n FROM async_tasks WHERE status IN ('pending','running')")
      .get().n;
    if (activeTasks > 0) {
      throw httpError('TASKS_ACTIVE', 409, `存在 ${activeTasks} 个运行中/排队任务；请等待完成或明确取消后再升级`);
    }
    const waitingExternal = db
      .prepare("SELECT COUNT(*) AS n FROM async_tasks WHERE status = 'waiting_external'")
      .get().n;
    if (waitingExternal > 0) {
      throw httpError('TASKS_WAITING_EXTERNAL', 409, `存在 ${waitingExternal} 个等待外部结果的任务；请保留或明确放弃后再升级`);
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    db = null;

    // ---- BACKED_UP ----
    const backupRoot = path.join(dataDir, 'backups', 'v2.1');
    const backup = createBackup(dbPath, backupRoot, { migrationId });
    if (!verifyBackup(backup.backupDir)) {
      throw httpError('BACKUP_VERIFY_FAILED', 500, '备份校验失败，禁止开始迁移');
    }
    journal.update({
      status: 'BACKED_UP',
      backupDir: backup.backupDir,
      dbSha256: sha256File(dbPath),
    });

    // ---- MIGRATING：单事务 ----
    journal.update({ status: 'MIGRATING' });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    ensureStoryboardV21Columns(db);
    ensureAsyncTaskV21Columns(db);
    ensureExternalAiTaskV21Columns(db);
    ensureCutVersionsV21Columns(db);
    ensureV21Domain(db);

    const migrateTx = db.transaction(() => {
      migrateScriptRevisions(db);
      migrateStoryboardSegments(db);
      migrateVideoCandidates(db);
      db.prepare(
        "INSERT INTO app_meta (key, value) VALUES ('app_schema_version', '2.1.0') ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run();
    });
    migrateTx();
    if (injectFailureAt === 'migrate') {
      throw new Error('注入失败：migrate 阶段');
    }

    // ---- VERIFYING：对账 ----
    journal.update({ status: 'VERIFYING' });
    const reconciliation = verifyV21Data(db);
    if (!reconciliation.ok) {
      throw httpError('RECONCILIATION_FAILED', 500, `对账失败：${reconciliation.issues.join('；')}`);
    }
    if (injectFailureAt === 'verify') {
      throw new Error('注入失败：verify 阶段');
    }

    // ---- COMMITTED ----
    db.close();
    db = null;
    journal.update({ status: 'COMMITTED', verifyReportPath: path.join(backup.backupDir, 'reconciliation.json') });
    fs.writeFileSync(
      path.join(backup.backupDir, 'reconciliation.json'),
      JSON.stringify(reconciliation, null, 2),
      'utf8'
    );
    return { committed: true, skipped: false, migrationId, reconciliation };
  } catch (err) {
    // 先关闭连接（避免 WAL checkpoint 覆盖恢复文件），再从备份恢复：禁止半迁移运行态
    if (db) {
      try {
        db.close();
      } catch {}
      db = null;
    }
    journal.markFailed({ reason: err.message });
    try {
      const state = journal.read();
      if (state && state.backupDir && fs.existsSync(state.backupDir)) {
        restoreBackup(dbPath, state.backupDir);
      }
    } catch (restoreErr) {
      log.error?.('备份恢复失败', { error: restoreErr.message });
    }
    throw err;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

function readSchemaVersion(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  const Database = require('better-sqlite3');
  let db = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const hasAppMeta = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='app_meta'")
      .get();
    if (!hasAppMeta) return null;
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'app_schema_version'").get();
    return row ? row.value : null;
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
}

function restoreBackup(dbPath, backupDir) {
  for (const suffix of ['', '-wal', '-shm']) {
    const src = path.join(backupDir, path.basename(dbPath) + suffix);
    const dest = dbPath + suffix;
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    else if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  }
}

/** 旧数据 → V2.1 事实源 */
function migrateScriptRevisions(db) {
  const episodes = db.prepare('SELECT * FROM episodes WHERE deleted_at IS NULL').all();
  for (const episode of episodes) {
    const existing = db
      .prepare('SELECT id FROM episode_script_revisions WHERE episode_id = ? LIMIT 1')
      .get(episode.id);
    if (existing) continue;
    const content = String(episode.script_content || '');
    const title = String(episode.title || '');
    if (!content.trim() && !title.trim()) continue;
    db.prepare(
      `INSERT INTO episode_script_revisions (episode_id, revision, status, title, content, source, created_at)
       VALUES (?, 1, 'draft', ?, ?, 'migration', ?)`
    ).run(episode.id, title, content, new Date().toISOString());
  }
}

function migrateStoryboardSegments(db) {
  const storyboards = db
    .prepare('SELECT * FROM storyboards WHERE deleted_at IS NULL')
    .all();
  for (const shot of storyboards) {
    const hasSegments = db
      .prepare('SELECT id FROM storyboard_segments WHERE storyboard_id = ? LIMIT 1')
      .get(shot.id);
    if (hasSegments) continue;
    const duration = Number(shot.duration) > 0 ? Number(shot.duration) : 6;
    db.prepare(
      `INSERT INTO storyboard_segments (storyboard_id, seq, start_seconds, end_seconds, visual, dialogue, sound, asset_refs_json, created_at, updated_at)
       VALUES (?, 1, 0, ?, ?, ?, '', '[]', ?, ?)`
    ).run(
      shot.id,
      duration,
      String(shot.description || shot.action || shot.title || ''),
      String(shot.dialogue || ''),
      new Date().toISOString(),
      new Date().toISOString()
    );
  }
}

function migrateVideoCandidates(db) {
  const storyboards = db
    .prepare("SELECT id, video_url FROM storyboards WHERE deleted_at IS NULL AND video_url IS NOT NULL AND video_url != ''")
    .all();
  for (const shot of storyboards) {
    const groupRow = db.prepare('SELECT id FROM director_candidate_groups WHERE shot_id = ?').get(String(shot.id));
    const groupId = groupRow ? groupRow.id : `grp_mig_${shot.id}`;
    if (!groupRow) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO director_candidate_groups (id, shot_id, status, selected_by, selected_at, created_at, updated_at)
         VALUES (?, ?, 'ready', 'system', ?, ?, ?)`
      ).run(groupId, String(shot.id), now, now, now);
    }
    const candidateId = `cand_mig_${shot.id}`;
    const existingCandidate = db.prepare('SELECT id FROM director_candidates WHERE id = ?').get(candidateId);
    if (existingCandidate) continue;
    const now = new Date().toISOString();
    const artifactId = `art_mig_${shot.id}`;
    const existingArtifact = db.prepare('SELECT id FROM director_artifacts WHERE id = ?').get(artifactId);
    if (!existingArtifact) {
      db.prepare(
        `INSERT INTO director_artifacts (id, job_id, attempt_number, version, status, artifact_path, sha256, file_size, manifest_json, created_at, ready_at)
         VALUES (?, ?, 1, 1, 'ready', ?, ?, 0, ?, ?, ?)`
      ).run(
        artifactId,
        `mig_${shot.id}`,
        shot.video_url,
        // 迁移的旧视频没有原始字节（可能是外部 URL），hash 记 URL 哈希并在 manifest 标注来源
        require('crypto').createHash('sha256').update(String(shot.video_url), 'utf8').digest('hex'),
        JSON.stringify({ shotId: shot.id, source: 'migration', url: shot.video_url }),
        now,
        now
      );
    }
    db.prepare(
      `INSERT INTO director_candidates (id, group_id, artifact_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, ?)`
    ).run(candidateId, groupId, artifactId, now, now);
    db.prepare(
      "UPDATE director_candidate_groups SET selected_candidate_id = ?, updated_at = ? WHERE id = ?"
    ).run(candidateId, now, groupId);
  }
}

/** 对账：迁移后必须满足的不变量 */
function verifyV21Data(db) {
  const issues = [];
  const episodeCount = db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE deleted_at IS NULL').get().n;
  const withContent = db
    .prepare(
      "SELECT COUNT(*) AS n FROM episodes WHERE deleted_at IS NULL AND (COALESCE(script_content, '') != '' OR COALESCE(title, '') != '')"
    )
    .get().n;
  const revisionEpisodes = db
    .prepare('SELECT COUNT(DISTINCT episode_id) AS n FROM episode_script_revisions')
    .get().n;
  if (revisionEpisodes !== withContent) {
    issues.push(`剧本版本覆盖 ${revisionEpisodes} 集，但含内容剧集 ${withContent} 集`);
  }
  const storyboardCount = db.prepare('SELECT COUNT(*) AS n FROM storyboards WHERE deleted_at IS NULL').get().n;
  const withSegments = db
    .prepare(
      `SELECT COUNT(DISTINCT sb.storyboard_id) AS n FROM storyboard_segments sb
       JOIN storyboards s ON s.id = sb.storyboard_id WHERE s.deleted_at IS NULL`
    )
    .get().n;
  if (withSegments !== storyboardCount) {
    issues.push(`有时段的分镜 ${withSegments} 个，但分镜总数 ${storyboardCount} 个`);
  }
  const videoShots = db
    .prepare("SELECT COUNT(*) AS n FROM storyboards WHERE deleted_at IS NULL AND video_url IS NOT NULL AND video_url != ''")
    .get().n;
  const migratedCandidates = db
    .prepare("SELECT COUNT(*) AS n FROM director_artifacts WHERE manifest_json LIKE '%\"source\":\"migration\"%'")
    .get().n;
  if (migratedCandidates !== videoShots) {
    issues.push(`旧视频 ${videoShots} 个，但迁移候选 ${migratedCandidates} 个`);
  }
  const version = db.prepare("SELECT value FROM app_meta WHERE key = 'app_schema_version'").get();
  if (!version || version.value !== '2.1.0') {
    issues.push('app_schema_version 不是 2.1.0');
  }
  return { ok: issues.length === 0, issues, counts: { episodeCount, storyboardCount, withSegments, migratedCandidates } };
}

/** 构造旧版本（V1）数据夹具：2 集剧本、3 个分镜（其一有 video_url） */
function buildV21MigrationFixture(db) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dramas (id, title, status, created_at, updated_at) VALUES (1, '旧项目', 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, script_content, duration, status, created_at, updated_at)
     VALUES (1, 1, 1, '第一集', '第一场 内景·走廊·深夜。', 60, 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO episodes (id, drama_id, episode_number, title, script_content, duration, status, created_at, updated_at)
     VALUES (2, 1, 2, '第二集', '第一场 外景·停车场·凌晨。', 45, 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, duration, video_url, status, created_at, updated_at)
     VALUES (1, 1, 1, '开场', 6, '/static/old/shot1.mp4', 'ready', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, duration, status, created_at, updated_at)
     VALUES (2, 1, 2, '走廊', 5, 'draft', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO storyboards (id, episode_id, storyboard_number, title, duration, status, created_at, updated_at)
     VALUES (3, 2, 1, '停车场', 7, 'draft', ?, ?)`
  ).run(now, now);
}

module.exports = { runV21Migration, verifyV21Data, restoreBackup, buildV21MigrationFixture };
