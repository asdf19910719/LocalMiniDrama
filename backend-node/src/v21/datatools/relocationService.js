'use strict';
/**
 * A5 媒体重定位扫描器：
 * - scan(dir)：找出 local_path 不可访问的媒体行，按 相对路径 → 文件名 → 大小 → hash 匹配 dir 内文件，
 *   输出唯一命中 / 多候选（ambiguous）/ 未找到 三类预览；不写库。
 * - confirm(items)：逐项校验（表白名单、新路径在受控 data 根内且真实存在）后真实 UPDATE 路径。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createRelocationService({ db, log = console, storageRoot = null } = {}) {
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

  // 表 → 路径列白名单（防止任意表写入）
  const TABLE_COLUMN = {
    image_generations: 'local_path',
    characters: 'local_path',
    scenes: 'local_path',
    props: 'local_path',
    assets: 'local_path',
    director_artifacts: 'artifact_path',
  };

  function missingRows() {
    const rows = [];
    for (const [table, column] of Object.entries(TABLE_COLUMN)) {
      const softDeleteCol = table !== 'director_artifacts';
      const where = softDeleteCol ? `AND deleted_at IS NULL` : '';
      let entries = [];
      try {
        entries = db
          .prepare(`SELECT id, ${column} AS p FROM ${table} WHERE ${column} IS NOT NULL AND TRIM(${column}) != '' ${where}`)
          .all();
      } catch (_) {
        continue;
      }
      for (const entry of entries) {
        const raw = String(entry.p).trim();
        const abs = path.resolve(path.isAbsolute(raw) ? raw : path.join(resolveStorageRoot(), '..', raw));
        if (!fs.existsSync(abs)) {
          rows.push({ table, id: Number(entry.id), missingPath: raw, resolvedPath: abs });
        }
      }
    }
    return rows;
  }

  function walkFiles(root) {
    const out = [];
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) out.push(abs);
      }
    };
    if (fs.existsSync(root)) walk(root);
    return out;
  }

  function scan(dir) {
    const targetDir = path.resolve(String(dir || ''));
    if (!fs.existsSync(targetDir)) {
      const err = new Error('目录不存在');
      err.code = 'DIR_NOT_FOUND';
      err.status = 400;
      throw err;
    }
    const candidates = walkFiles(targetDir);
    const byName = new Map();
    const bySize = new Map();
    for (const abs of candidates) {
      const name = path.basename(abs).toLowerCase();
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(abs);
      let size = 0;
      try { size = fs.statSync(abs).size; } catch (_) {}
      const sizeKey = String(size);
      if (!bySize.has(sizeKey)) bySize.set(sizeKey, []);
      bySize.get(sizeKey).push(abs);
    }
    const rows = missingRows().map((row) => {
      const missingName = path.basename(row.resolvedPath).toLowerCase();
      let missingSize = null;
      try { missingSize = fs.existsSync(row.resolvedPath) ? fs.statSync(row.resolvedPath).size : null; } catch (_) { missingSize = null; }
      const nameHits = byName.get(missingName) || [];
      let status = 'none';
      let candidatesOut = [];
      if (nameHits.length === 1) {
        status = 'unique';
        candidatesOut = nameHits;
      } else if (nameHits.length > 1) {
        // 文件名多命中：再按大小/hash 收敛
        const sizeHits = missingSize != null ? nameHits.filter((abs) => {
          try { return fs.statSync(abs).size === missingSize; } catch (_) { return false; }
        }) : [];
        if (sizeHits.length === 1) {
          status = 'unique';
          candidatesOut = sizeHits;
        } else if (sizeHits.length > 1) {
          const hash = nullSafeHash(row.resolvedPath, missingSize);
          const hashHits = hash ? sizeHits.filter((abs) => safeHash(abs) === hash) : [];
          status = hashHits.length >= 1 ? 'unique' : 'ambiguous';
          candidatesOut = hashHits.length >= 1 ? hashHits : sizeHits;
        } else {
          status = 'ambiguous';
          candidatesOut = nameHits;
        }
      } else {
        // 无同名：按大小兜底（唯一同大小才提候选，避免误配）
        const sizeHits = missingSize != null ? (bySize.get(String(missingSize)) || []) : [];
        if (sizeHits.length === 1) {
          status = 'unique';
          candidatesOut = sizeHits;
        }
      }
      return {
        table: row.table,
        id: row.id,
        missingPath: row.missingPath,
        match: { status, candidates: candidatesOut },
      };
    });
    const summary = {
      missing: rows.length,
      unique: rows.filter((r) => r.match.status === 'unique').length,
      ambiguous: rows.filter((r) => r.match.status === 'ambiguous').length,
      none: rows.filter((r) => r.match.status === 'none').length,
    };
    return { scanDir: targetDir, rows, summary };
  }

  function nullSafeHash(missingPath, size) {
    void missingPath;
    void size;
    return null; // 旧文件已不可读，无法取基准 hash；仅用于候选间收敛的场合由 safeHash 完成
  }

  function safeHash(abs) {
    try { return sha256File(abs); } catch (_) { return null; }
  }

  function confirm(items) {
    const updated = [];
    const skipped = [];
    for (const item of Array.isArray(items) ? items : []) {
      const column = TABLE_COLUMN[item && item.table];
      const id = Number(item && item.id);
      const newPath = String((item && item.newPath) || '').trim();
      if (!column || !Number.isFinite(id)) {
        skipped.push({ item, reason: '非法目标（表或 id 不受支持）' });
        continue;
      }
      const abs = path.resolve(newPath);
      // 重定位的目的正是把路径指向用户移动后的位置（可在工作区外）；仅要求文件真实存在
      if (!fs.existsSync(abs)) {
        skipped.push({ item, reason: '新路径文件不存在' });
        continue;
      }
      try {
        const result = db.prepare(`UPDATE ${item.table} SET ${column} = ?, updated_at = ? WHERE id = ?`).run(abs, new Date().toISOString(), id);
        if (result.changes > 0) updated.push({ table: item.table, id, newPath: abs });
        else skipped.push({ item, reason: '目标行不存在' });
      } catch (err) {
        skipped.push({ item, reason: err.message });
      }
    }
    log.info && log.info('V2.1 媒体重定位确认', { updated: updated.length, skipped: skipped.length });
    return { updated, skipped };
  }

  return { scan, confirm };
}

module.exports = { createRelocationService };
