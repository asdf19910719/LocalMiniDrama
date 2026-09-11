'use strict';
/**
 * 归档导入真实校验（Task 5-C）。
 * 收 JSON { path }（本地 zip 路径），用 adm-zip 读取并产出：
 * - 硬错误：path 缺失 400 / 文件不存在 404 / 非 zip 400（与导入端点"只收本地路径"的诚实口径一致）；
 * - 七项检查矩阵（格式/版本/结构/完整性/媒体/名称/空间）逐项 pass/warn/block/unsupported + 原因；
 * - 概要指标（项目名/剧集数/媒体条目数/预计大小）；
 * - 版本校验对照 2.1 协议：V1 导出（project.json version=1.7）如实返回 unsupported，不伪装通过。
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const SUPPORTED_VERSION = '2.1';

function httpError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function createArchiveValidateService({ db, log }) {
  /** 七项检查矩阵（顺序即呈现顺序）；spaceProbeDir 为磁盘剩余空间的探测目录 */
  function buildChecks({ zip, manifest, projectName }, { spaceProbeDir } = {}) {
    const checks = [];

    // 1. 格式：走到这里说明文件存在且 adm-zip 可打开（否则已在硬错误阶段 404/400）
    checks.push({ id: 'format', label: '归档格式', status: 'pass', detail: '文件存在且为可读取的 ZIP 归档' });

    // 2. 版本：对照 episode-package/制作协议 2.1；V1 导出为 1.7 → unsupported
    const archiveVersion = manifest ? String(manifest.version || '') : '';
    if (!manifest) {
      checks.push({ id: 'version', label: '协议版本', status: 'block', detail: '缺少 project.json，无法读取归档版本' });
    } else if (archiveVersion === SUPPORTED_VERSION) {
      checks.push({ id: 'version', label: '协议版本', status: 'pass', detail: `归档版本 ${archiveVersion}` });
    } else {
      checks.push({
        id: 'version',
        label: '协议版本',
        status: 'unsupported',
        detail: `检测到归档版本 ${archiveVersion || '未知'}，当前仅支持 ${SUPPORTED_VERSION}`,
      });
    }

    // 3. 结构：manifest 需含 drama 与 episodes 数组
    if (manifest && manifest.drama && Array.isArray(manifest.episodes)) {
      checks.push({ id: 'structure', label: '结构完整', status: 'pass', detail: `project.json 结构合法（${manifest.episodes.length} 个剧集条目）` });
    } else if (manifest) {
      checks.push({ id: 'structure', label: '结构完整', status: 'block', detail: 'project.json 缺少 drama 或 episodes 字段' });
    } else {
      checks.push({ id: 'structure', label: '结构完整', status: 'block', detail: '归档中缺少 project.json' });
    }

    // 4. 完整性：全部条目可解压
    let integrityBroken = null;
    let mediaCount = 0;
    let estimatedSizeBytes = 0;
    const entries = zip.getEntries();
    for (const entry of entries) {
      const isMedia = entry.entryName === 'media' || entry.entryName.startsWith('media/');
      if (isMedia && !entry.isDirectory) mediaCount += 1;
      estimatedSizeBytes += entry.header.size || 0;
      if (integrityBroken) continue;
      try {
        entry.getData();
      } catch (err) {
        integrityBroken = entry.entryName;
      }
    }
    if (integrityBroken) {
      checks.push({ id: 'integrity', label: '解压完整', status: 'block', detail: `条目 ${integrityBroken} 无法解压（归档可能损坏）` });
    } else {
      checks.push({ id: 'integrity', label: '解压完整', status: 'pass', detail: `全部 ${entries.length} 个条目均可解压` });
    }

    // 5. 媒体：media/ 条目计数
    checks.push({
      id: 'media',
      label: '媒体文件',
      status: 'pass',
      detail: `媒体条目 ${mediaCount} 个（缺失媒体导入时保留引用并告警）`,
    });

    // 6. 名称：与现有项目重名检查（导入永不覆盖，重名仅告警）
    let nameStatus = 'pass';
    let nameDetail = projectName ? `项目名「${projectName}」可用` : 'manifest 未提供项目名';
    if (projectName) {
      try {
        const dup = db.prepare('SELECT id FROM dramas WHERE title = ? AND deleted_at IS NULL LIMIT 1').get(projectName);
        if (dup) {
          nameStatus = 'warn';
          nameDetail = `与现有项目重名：「${projectName}」已存在；导入会创建新项目，不会覆盖现有项目`;
        }
      } catch (_) { /* 表不可用时跳过重名检查 */ }
    }
    checks.push({ id: 'name', label: '项目名称', status: nameStatus, detail: nameDetail });

    // 7. 空间：解压后预计大小 vs 磁盘剩余（探测归档所在盘）
    let spaceCheck;
    try {
      const probeDir = spaceProbeDir || process.cwd();
      const stats = fs.statfsSync(probeDir);
      const freeBytes = Number(stats.bsize) * Number(stats.bavail);
      const fmt = (n) => `${(Number(n) / 1048576).toFixed(1)} MB`;
      if (freeBytes > estimatedSizeBytes) {
        spaceCheck = { id: 'space', label: '磁盘空间', status: 'pass', detail: `磁盘剩余约 ${fmt(freeBytes)}，解压预计需要 ${fmt(estimatedSizeBytes)}` };
      } else {
        spaceCheck = { id: 'space', label: '磁盘空间', status: 'block', detail: `磁盘剩余不足：约 ${fmt(freeBytes)}，解压预计需要 ${fmt(estimatedSizeBytes)}` };
      }
    } catch (_) {
      spaceCheck = { id: 'space', label: '磁盘空间', status: 'warn', detail: '无法检测磁盘剩余空间，请在导入前自行确认' };
    }
    checks.push(spaceCheck);

    return { checks, mediaCount, estimatedSizeBytes };
  }

  /**
   * 校验本地归档 zip。返回 { overall, archiveVersion, supportedVersion, summary, checks }。
   * overall：ok（全部通过）/ unsupported（版本不受支持，其余照实呈现）/ error（结构或完整性阻断）。
   */
  function validate({ path: archivePath }, opts = {}) {
    if (!archivePath || !String(archivePath).trim()) {
      throw httpError('VALIDATION_ERROR', 400, '请提供归档文件路径');
    }
    const rawPath = String(archivePath).trim();
    let stat;
    try {
      stat = fs.statSync(rawPath);
    } catch (_) {
      throw httpError('NOT_FOUND', 404, '归档文件不存在，请确认路径');
    }
    if (!stat.isFile()) {
      throw httpError('ARCHIVE_INVALID', 400, '路径不是文件');
    }
    let zip;
    try {
      zip = new AdmZip(rawPath);
      zip.getEntries();
    } catch (err) {
      log.warn?.('archive validate: bad zip', { path: rawPath, error: err.message });
      throw httpError('ARCHIVE_INVALID', 400, '文件不是有效的 ZIP 归档');
    }

    const manifestEntry = zip.getEntry('project.json');
    let manifest = null;
    if (manifestEntry) {
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
      } catch (_) {
        manifest = null;
      }
    }
    const projectName = manifest && manifest.drama ? String(manifest.drama.title || '') : '';

    const { checks, mediaCount, estimatedSizeBytes } = buildChecks(
      { zip, manifest, projectName },
      { spaceProbeDir: opts.spaceProbeDir || path.dirname(rawPath) }
    );

    const hasBlock = checks.some((c) => c.status === 'block');
    const overall = checks.some((c) => c.status === 'unsupported')
      ? 'unsupported'
      : hasBlock ? 'error' : 'ok';

    return {
      overall,
      archiveVersion: manifest ? String(manifest.version || '') : '',
      supportedVersion: SUPPORTED_VERSION,
      summary: {
        projectName,
        episodeCount: manifest && Array.isArray(manifest.episodes) ? manifest.episodes.length : 0,
        characterCount: manifest && Array.isArray(manifest.characters) ? manifest.characters.length : 0,
        entryCount: zip.getEntries().length,
        mediaCount,
        estimatedSizeBytes,
        zipSizeBytes: stat.size,
      },
      checks,
    };
  }

  return { validate };
}

module.exports = { createArchiveValidateService, SUPPORTED_VERSION };
