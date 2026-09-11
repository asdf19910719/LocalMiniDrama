'use strict';
/**
 * A5 媒体重定位扫描器（Task 4.4 扩展：五态 + 匹配证据 + 确认阻断）：
 * - scan(dir)：找出 local_path 不可访问的媒体行，按 文件名 → 大小 → hash 匹配 dir 内文件，
 *   输出五态预览（不写库）：unique 唯一命中 / ambiguous 多候选（需人工选择）/
 *   hash_mismatch 文件名命中但内容 hash 与记录不一致（默认阻断）/
 *   path_escape 候选解析后越出受控工作区根（默认阻断）/ none 未找到；
 *   每行带 evidence 匹配证据字符串（说明命中依据与阻断原因）。
 * - confirm(items)：先全量校验——表白名单、新路径必须位于受控工作区 data 根内、
 *   记录了内容 sha256 的表（director_artifacts）内容必须一致；任一阻断项 → 整批拒绝
 *   （VALIDATION_ERROR，零写入，全有或全无）。通过后逐项校验文件真实存在并 UPDATE 路径。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function httpError(code, status, message) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
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

  // 受控工作区根 = 媒体存储根的上一级（data 根）——与完整性检查"受控目录"同口径
  function controlledRoot() {
    return path.resolve(resolveStorageRoot(), '..');
  }

  function isInsideControlledRoot(abs) {
    const rel = path.relative(controlledRoot(), abs);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
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

  // 表 → 内容 hash 基线列（记录了文件 sha256 的表才可做 hash 一致性校验）
  const TABLE_HASH = {
    director_artifacts: 'sha256',
  };

  function getStoredHash(table, id) {
    const column = TABLE_HASH[table];
    if (!column) return null;
    try {
      const row = db.prepare(`SELECT ${column} AS h FROM ${table} WHERE id = ?`).get(id);
      return row && row.h ? String(row.h).toLowerCase() : null;
    } catch (_) {
      return null;
    }
  }

  function shortHash(hash) {
    return `${String(hash).slice(0, 10)}…`;
  }

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
          rows.push({ table, id: entry.id, missingPath: raw, resolvedPath: abs });
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
      const storedHash = getStoredHash(row.table, row.id);
      let status = 'none';
      let candidatesOut = [];
      let evidence = '';
      if (nameHits.length === 1) {
        status = 'unique';
        candidatesOut = nameHits;
        evidence = storedHash ? '文件名唯一命中，正在校验内容 hash' : '文件名唯一命中（未记录内容 hash，未校验）';
      } else if (nameHits.length > 1) {
        // 文件名多命中：再按大小/hash 收敛
        const sizeHits = missingSize != null ? nameHits.filter((abs) => {
          try { return fs.statSync(abs).size === missingSize; } catch (_) { return false; }
        }) : [];
        if (sizeHits.length === 1) {
          status = 'unique';
          candidatesOut = sizeHits;
          evidence = '文件名多命中，按文件大小收敛为唯一（未记录内容 hash，未校验）';
        } else if (sizeHits.length > 1) {
          const hash = nullSafeHash(row.resolvedPath, missingSize);
          const hashHits = hash ? sizeHits.filter((abs) => safeHash(abs) === hash) : [];
          status = hashHits.length >= 1 ? 'unique' : 'ambiguous';
          candidatesOut = hashHits.length >= 1 ? hashHits : sizeHits;
          evidence = hashHits.length >= 1 ? '文件名与内容 hash 收敛为唯一' : '文件名多命中，需人工选择候选';
        } else {
          status = 'ambiguous';
          candidatesOut = nameHits;
          evidence = storedHash ? '文件名多命中，内容 hash 未逐项确认，需人工选择候选' : '文件名多命中，需人工选择候选';
        }
      } else {
        // 无同名：按大小兜底（唯一同大小才提候选，避免误配）
        const sizeHits = missingSize != null ? (bySize.get(String(missingSize)) || []) : [];
        if (sizeHits.length === 1) {
          status = 'unique';
          candidatesOut = sizeHits;
          evidence = '无同名文件，按文件大小唯一命中（未记录内容 hash，未校验）';
        } else {
          evidence = '新目录中未找到可信候选，继续保持离线';
        }
      }
      // hash 基线校验：唯一命中且该表记录了内容 sha256 时，不一致 → 阻断
      if (status === 'unique' && candidatesOut.length === 1 && storedHash) {
        const candHash = safeHash(candidatesOut[0]);
        if (candHash && candHash !== storedHash) {
          status = 'hash_mismatch';
          evidence = `文件名命中但内容 hash 不一致（记录 ${shortHash(storedHash)} ≠ 实际 ${shortHash(candHash)}），默认阻断，避免替换为不同内容`;
        } else if (candHash) {
          evidence = '文件名唯一命中，内容 hash 一致';
        } else {
          evidence += '（候选 hash 不可读，未校验）';
        }
      }
      // 受控根校验：候选解析后全部越出受控工作区根 → 阻断（优先于其他状态）
      if (candidatesOut.length >= 1 && candidatesOut.every((c) => !isInsideControlledRoot(c))) {
        status = 'path_escape';
        evidence = `候选位于受控工作区根（${controlledRoot()}）之外，重定位被阻断；请将媒体移回受控根内后重新扫描`;
      }
      return {
        table: row.table,
        id: row.id,
        missingPath: row.missingPath,
        match: { status, candidates: candidatesOut },
        evidence,
      };
    });
    const summary = {
      missing: rows.length,
      unique: rows.filter((r) => r.match.status === 'unique').length,
      ambiguous: rows.filter((r) => r.match.status === 'ambiguous').length,
      hashMismatch: rows.filter((r) => r.match.status === 'hash_mismatch').length,
      pathEscape: rows.filter((r) => r.match.status === 'path_escape').length,
      none: rows.filter((r) => r.match.status === 'none').length,
    };
    return { scanDir: targetDir, controlledRoot: controlledRoot(), rows, summary };
  }

  function nullSafeHash(missingPath, size) {
    void missingPath;
    void size;
    return null; // 旧文件已不可读，无法取基准 hash；仅用于候选间收敛的场合由 safeHash 完成
  }

  function safeHash(abs) {
    try { return sha256File(abs); } catch (_) { return null; }
  }

  // 无 updated_at 列的表（UPDATE 时不触碰时间戳）
  const TABLE_NO_UPDATED_AT = new Set(['director_artifacts']);

  function confirm(items) {
    const prepared = [];
    const blocked = [];
    const skipped = [];
    for (const item of Array.isArray(items) ? items : []) {
      const column = TABLE_COLUMN[item && item.table];
      const id = item ? item.id : undefined;
      const idValid = Number.isFinite(id) || (typeof id === 'string' && id.trim() !== '');
      const newPath = String((item && item.newPath) || '').trim();
      if (!column || !idValid) {
        skipped.push({ item, reason: '非法目标（表或 id 不受支持）' });
        continue;
      }
      if (!newPath) {
        skipped.push({ item, reason: '新路径为空' });
        continue;
      }
      const abs = path.resolve(newPath);
      // 受控根校验：重定位只允许把路径指向受控工作区根内（越界默认阻断，不得写库）
      if (!isInsideControlledRoot(abs)) {
        blocked.push(`${item.table}#${id} 候选路径越出受控工作区根（${controlledRoot()}）：${abs}`);
        continue;
      }
      // hash 基线校验：记录了内容 sha256 的表，新文件内容必须一致
      const storedHash = getStoredHash(item.table, id);
      if (storedHash && fs.existsSync(abs)) {
        const actual = safeHash(abs);
        if (actual && actual !== storedHash) {
          blocked.push(`${item.table}#${id} 内容 hash 与记录不一致（记录 ${shortHash(storedHash)} ≠ 实际 ${shortHash(actual)}）`);
          continue;
        }
      }
      prepared.push({ item, table: item.table, column, id, abs });
    }
    // 全有或全无：存在阻断项（hash_mismatch / path_escape）时整批拒绝、零写入
    if (blocked.length) {
      throw httpError(
        'VALIDATION_ERROR',
        400,
        `重定位确认被拒绝：${blocked.length} 项被阻断——${blocked.join('；')}。受控根外路径与 hash 不一致的匹配默认阻断，不得更新。`
      );
    }
    const updated = [];
    for (const p of prepared) {
      if (!fs.existsSync(p.abs)) {
        skipped.push({ item: p.item, reason: '新路径文件不存在' });
        continue;
      }
      try {
        const hasUpdatedAt = !TABLE_NO_UPDATED_AT.has(p.table);
        const result = hasUpdatedAt
          ? db.prepare(`UPDATE ${p.table} SET ${p.column} = ?, updated_at = ? WHERE id = ?`).run(p.abs, new Date().toISOString(), p.id)
          : db.prepare(`UPDATE ${p.table} SET ${p.column} = ? WHERE id = ?`).run(p.abs, p.id);
        if (result.changes > 0) updated.push({ table: p.table, id: p.id, newPath: p.abs });
        else skipped.push({ item: p.item, reason: '目标行不存在' });
      } catch (err) {
        skipped.push({ item: p.item, reason: err.message });
      }
    }
    log.info && log.info('V2.1 媒体重定位确认', { updated: updated.length, skipped: skipped.length });
    return { updated, skipped };
  }

  return { scan, confirm };
}

module.exports = { createRelocationService };
