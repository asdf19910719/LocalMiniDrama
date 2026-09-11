'use strict';
/**
 * A2 完整性检查扫描器（只读）：逐项体检工作区数据，产出
 * {severity: ok|warn|error, id, title, detail, recovery}；recovery 映射前端唯一恢复落点：
 * relocation=媒体重定位 / reindex=重建任务索引 / cleanup=物理清理 / paths=路径配置 / null=无自动工具。
 */
const fs = require('node:fs');
const path = require('node:path');

function createIntegrityService({ db, log = console, storageRoot = null } = {}) {
  function resolveStorageRoot() {
    if (storageRoot) return path.resolve(storageRoot);
    try {
      const { loadConfig } = require('../../config/index.js');
      const configured = loadConfig().storage?.local_path;
      if (configured) {
        return path.resolve(path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured));
      }
    } catch (_) {}
    return path.resolve(process.cwd(), 'data', 'storage');
  }

  function collectMediaRefs() {
    // 行内声明的媒体绝对路径（local_path 优先，其余作参考）
    const refs = [];
    const push = (table, column, where = 'deleted_at IS NULL') => {
      try {
        const rows = db.prepare(`SELECT ${column} AS p FROM ${table} WHERE ${column} IS NOT NULL AND TRIM(${column}) != '' AND ${where}`).all();
        for (const row of rows) refs.push(String(row.p));
      } catch (_) {}
    };
    push('image_generations', 'local_path');
    push('characters', 'local_path');
    push('scenes', 'local_path');
    push('props', 'local_path');
    push('director_artifacts', 'artifact_path', '1=1');
    push('assets', 'local_path');
    return refs;
  }

  function scan() {
    const storage = resolveStorageRoot();
    const dataRoot = path.resolve(storage, '..');
    const items = [];
    const add = (id, severity, title, detail, recovery = null, counts = null) => {
      items.push({ id, severity, title, detail, recovery, ...(counts ? { counts } : {}) });
    };

    // 1. SQLite 一致性
    const integrityRows = db.pragma('integrity_check', { simple: true });
    if (integrityRows === 'ok') {
      add('sqlite-integrity', 'ok', 'SQLite 完整性', 'integrity_check 通过', null, { scanned: 1, flagged: 0 });
    } else {
      add('sqlite-integrity', 'error', 'SQLite 完整性', `integrity_check 异常：${String(integrityRows).slice(0, 200)}`);
    }

    // 2. 外键一致性
    const fkRows = db.pragma('foreign_key_check');
    if (!fkRows.length) {
      add('sqlite-foreign-keys', 'ok', 'SQLite 外键', '引用完整，项目/剧集关系一致', null, { scanned: 1, flagged: 0 });
    } else {
      add('sqlite-foreign-keys', 'error', 'SQLite 外键', `${fkRows.length} 处外键不一致（如 ${fkRows[0].table}）`);
    }

    // 3. 媒体存在性（缺失=error；越界单独归受控目录检查）
    const mediaRefs = collectMediaRefs();
    const missing = [];
    const outside = [];
    for (const raw of mediaRefs) {
      const resolved = path.resolve(path.isAbsolute(raw) ? raw : path.join(dataRoot, raw));
      const relative = path.relative(dataRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        outside.push(raw);
        continue;
      }
      if (!fs.existsSync(resolved)) missing.push(raw);
    }
    if (!missing.length) {
      add('media-existence', 'ok', '媒体存在性', `已检查 ${mediaRefs.length} 个媒体引用，文件均存在`, null, { scanned: mediaRefs.length, flagged: 0 });
    } else {
      add(
        'media-existence',
        'error',
        '媒体文件缺失',
        `${missing.length} 个引用的 local_path 不可访问（如 ${path.basename(missing[0])}）`,
        'relocation',
        { scanned: mediaRefs.length, flagged: missing.length }
      );
    }

    // 4. 引用完整性（悬空关联）
    const dangling = [];
    const danglingOf = (sql, label) => {
      try {
        const n = db.prepare(sql).get().n;
        if (n > 0) dangling.push(`${label} ${n} 条`);
      } catch (_) {}
    };
    danglingOf('SELECT COUNT(*) AS n FROM episode_characters ec LEFT JOIN episodes e ON e.id = ec.episode_id WHERE e.id IS NULL OR e.deleted_at IS NOT NULL', 'episode_characters→episodes');
    danglingOf('SELECT COUNT(*) AS n FROM episode_characters ec LEFT JOIN characters c ON c.id = ec.character_id WHERE c.id IS NULL OR c.deleted_at IS NOT NULL', 'episode_characters→characters');
    danglingOf('SELECT COUNT(*) AS n FROM storyboard_character_variants scv LEFT JOIN storyboards sb ON sb.id = scv.storyboard_id WHERE sb.id IS NULL OR sb.deleted_at IS NOT NULL', 'storyboard_character_variants→storyboards');
    danglingOf('SELECT COUNT(*) AS n FROM storyboard_character_variants scv LEFT JOIN characters c ON c.id = scv.character_id WHERE c.id IS NULL OR c.deleted_at IS NOT NULL', 'storyboard_character_variants→characters');
    danglingOf('SELECT COUNT(*) AS n FROM storyboard_props sp LEFT JOIN storyboards sb ON sb.id = sp.storyboard_id WHERE sb.id IS NULL OR sb.deleted_at IS NOT NULL', 'storyboard_props→storyboards');
    danglingOf('SELECT COUNT(*) AS n FROM storyboard_props sp LEFT JOIN props p ON p.id = sp.prop_id WHERE p.id IS NULL OR p.deleted_at IS NOT NULL', 'storyboard_props→props');
    danglingOf('SELECT COUNT(*) AS n FROM storyboards sb LEFT JOIN scenes s ON s.id = sb.scene_id WHERE sb.scene_id IS NOT NULL AND (s.id IS NULL OR s.deleted_at IS NOT NULL)', 'storyboards.scene_id');
    if (!dangling.length) {
      add('reference-integrity', 'ok', '引用完整性', '分镜引用/剧集角色/场景关联均有效', null, { scanned: 7, flagged: 0 });
    } else {
      add('reference-integrity', 'warn', '悬空引用', `存在悬空引用：${dangling.join('；')}`, null, { scanned: 7, flagged: dangling.length });
    }

    // 5. 任务索引（v21 归属任务指向不存在的分镜）
    let taskScanned = 0;
    const taskDangling = [];
    try {
      const rows = db
        .prepare(
          `SELECT id, owner_type, owner_id FROM async_tasks
           WHERE deleted_at IS NULL AND owner_type IN ('storyboard_video', 'storyboard_image') AND owner_id IS NOT NULL AND owner_id != ''`
        )
        .all();
      for (const row of rows) {
        taskScanned += 1;
        const shot = db.prepare('SELECT id FROM storyboards WHERE id = ?').get(Number(row.owner_id));
        if (!shot) taskDangling.push(`${row.id}→storyboard ${row.owner_id}`);
      }
    } catch (_) {}
    if (!taskDangling.length) {
      add('task-index', 'ok', '任务索引', `生成任务归属均指向存在的资源（检查 ${taskScanned} 条）`, null, { scanned: taskScanned, flagged: 0 });
    } else {
      add('task-index', 'warn', '任务索引', `${taskDangling.length} 个任务无对应资源记录（如 ${taskDangling[0]}）`, 'reindex', { scanned: taskScanned, flagged: taskDangling.length });
    }

    // 6. 受控目录越界
    if (!outside.length) {
      add('controlled-root', 'ok', '受控目录', '媒体路径均位于工作区 data 根内', null, { scanned: mediaRefs.length, flagged: 0 });
    } else {
      add('controlled-root', 'warn', '受控目录越界', `${outside.length} 个文件位于工作区外（如 ${path.basename(outside[0])}）`, 'paths', { scanned: mediaRefs.length, flagged: outside.length });
    }

    // 7. 孤儿文件（storage 下未被任何行引用）
    const known = new Set();
    for (const raw of mediaRefs) {
      known.add(path.resolve(path.isAbsolute(raw) ? raw : path.join(dataRoot, raw)).toLowerCase());
    }
    const orphans = [];
    let fileScanned = 0;
    try {
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(abs);
          else {
            fileScanned += 1;
            if (!known.has(abs.toLowerCase())) orphans.push(abs);
          }
        }
      };
      if (fs.existsSync(storage)) walk(storage);
    } catch (_) {}
    if (!orphans.length) {
      add('orphan-files', 'ok', '孤儿文件', `storage 下 ${fileScanned} 个文件均有引用`, null, { scanned: fileScanned, flagged: 0 });
    } else {
      const sample = orphans.slice(0, 3).map((p) => path.relative(storage, p)).join('、');
      add('orphan-files', 'warn', '孤儿文件', `${orphans.length} 个未引用文件（如 ${sample}）`, 'cleanup', { scanned: fileScanned, flagged: orphans.length });
    }

    const summary = { ok: 0, warn: 0, error: 0 };
    for (const entry of items) summary[entry.severity] += 1;
    return { storageRoot: storage, dataRoot, items, summary, startedAt: new Date().toISOString() };
  }

  log.info && log.info('V2.1 完整性扫描器就绪');
  return { run: scan };
}

module.exports = { createIntegrityService };
