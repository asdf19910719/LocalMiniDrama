const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

function hashBuffer(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function rowsForIds(db, table, column, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM ${table} WHERE ${column} IN (${placeholders})`).all(...ids);
}

function uniqueRows(rows) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function expandArtifactClosure(db, requestedIds) {
  const ids = new Set(requestedIds);
  let changed = true;
  while (changed) {
    changed = false;
    const current = [...ids];
    const candidates = rowsForIds(db, 'director_candidates', 'artifact_id', current);
    const groupIds = [...new Set(candidates.map((candidate) => candidate.group_id).filter(Boolean))];
    const groupCandidates = rowsForIds(db, 'director_candidates', 'group_id', groupIds);
    const groups = uniqueRows([
      ...rowsForIds(db, 'director_candidate_groups', 'selected_artifact_id', current),
      ...rowsForIds(db, 'director_candidate_groups', 'id', groupIds),
    ]);
    const placeholders = current.map(() => '?').join(',');
    const anchors = current.length ? db.prepare(`SELECT * FROM director_anchors
      WHERE source_artifact_id IN (${placeholders}) OR derived_artifact_id IN (${placeholders})`).all(...current, ...current) : [];
    const relatedIds = [
      ...groupCandidates.map((candidate) => candidate.artifact_id),
      ...groups.map((group) => group.selected_artifact_id),
      ...anchors.flatMap((anchor) => [anchor.source_artifact_id, anchor.derived_artifact_id]),
    ].filter(Boolean);
    for (const artifactId of relatedIds) {
      if (!ids.has(artifactId)) {
        ids.add(artifactId);
        changed = true;
      }
    }
  }
  return [...ids];
}

function assertUniqueIds(records, label) {
  if (!Array.isArray(records)) throw new Error(`Artifact bundle relationship closure is invalid: ${label} must be an array`);
  const ids = records.map((record) => record?.id);
  if (ids.some((recordId) => !recordId) || new Set(ids).size !== ids.length) {
    throw new Error(`Artifact bundle relationship closure is invalid: duplicate or missing ${label} id`);
  }
  return new Set(ids);
}

function validateBundleClosure(bundle) {
  const artifacts = bundle.artifacts || [];
  const artifactIds = assertUniqueIds(artifacts, 'artifact');
  for (const artifact of artifacts) {
    if (!artifact.fileName || !artifact.sha256 || artifact.record?.id !== artifact.id) {
      throw new Error('Artifact bundle relationship closure is invalid: artifact record mismatch');
    }
  }
  if (bundle.version !== 'director_artifact_bundle_v2') return;
  const relationships = bundle.relationships || {};
  const jobIds = assertUniqueIds(relationships.jobs || [], 'job');
  const groupIds = assertUniqueIds(relationships.candidateGroups || [], 'candidate group');
  assertUniqueIds(relationships.candidates || [], 'candidate');
  assertUniqueIds(relationships.anchors || [], 'anchor');
  for (const artifact of artifacts) {
    if (!artifact.record?.job_id || !jobIds.has(artifact.record.job_id)) throw new Error('Artifact bundle relationship closure is invalid: artifact job is missing');
  }
  for (const job of relationships.jobs || []) {
    if (job.artifact_id && !artifactIds.has(job.artifact_id)) throw new Error('Artifact bundle relationship closure is invalid: job artifact is missing');
  }
  for (const group of relationships.candidateGroups || []) {
    if (group.selected_artifact_id && !artifactIds.has(group.selected_artifact_id)) throw new Error('Artifact bundle relationship closure is invalid: selected artifact is missing');
  }
  for (const candidate of relationships.candidates || []) {
    if (!groupIds.has(candidate.group_id) || !artifactIds.has(candidate.artifact_id) || !jobIds.has(candidate.job_id)) {
      throw new Error('Artifact bundle relationship closure is invalid: candidate reference is missing');
    }
  }
  for (const anchor of relationships.anchors || []) {
    if (!artifactIds.has(anchor.source_artifact_id) || !artifactIds.has(anchor.derived_artifact_id)) {
      throw new Error('Artifact bundle relationship closure is invalid: anchor reference is missing');
    }
  }
}

function upsertRecord(db, table, record) {
  if (!record?.id) throw new Error(`Restored ${table} record is missing id`);
  const available = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  const columns = Object.keys(record).filter((column) => available.has(column));
  const assignments = columns.filter((column) => column !== 'id').map((column) => `${column}=excluded.${column}`);
  const placeholders = columns.map(() => '?').join(',');
  const conflict = assignments.length ? ` DO UPDATE SET ${assignments.join(',')}` : ' DO NOTHING';
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT(id)${conflict}`)
    .run(...columns.map((column) => record[column]));
}

function inside(root, target) {
  try {
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    const relative = path.relative(realRoot, realTarget);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  } catch (_) {
    return false;
  }
}

function getArtifactUsage(db, { quotaBytes = Number(process.env.DIRECTOR_ARTIFACT_QUOTA_BYTES || 200 * 1024 * 1024 * 1024) } = {}) {
  const row = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(file_size), 0) AS total_bytes FROM director_artifacts WHERE status <> 'archived'").get();
  const totalBytes = Number(row.total_bytes || 0);
  return { artifactCount: Number(row.count || 0), totalBytes, quotaBytes: Number(quotaBytes), remainingBytes: Math.max(0, Number(quotaBytes) - totalBytes), overQuota: totalBytes > Number(quotaBytes) };
}

function unreferencedArtifacts(db) {
  return db.prepare(`SELECT artifact.* FROM director_artifacts artifact
    WHERE artifact.status = 'ready'
      AND NOT EXISTS (SELECT 1 FROM director_candidate_groups group_row WHERE group_row.selected_artifact_id = artifact.id AND group_row.status = 'selected')
      AND NOT EXISTS (SELECT 1 FROM director_anchors anchor WHERE anchor.source_artifact_id = artifact.id OR anchor.derived_artifact_id = artifact.id)
    ORDER BY artifact.created_at ASC, artifact.id ASC`).all();
}

function archiveUnreferencedArtifacts(db, { artifactRoot, targetBytes = 0, dryRun = false, now = new Date().toISOString() } = {}) {
  if (!artifactRoot) throw new Error('artifactRoot is required');
  const usage = getArtifactUsage(db);
  let projectedBytes = usage.totalBytes;
  const selected = [];
  for (const artifact of unreferencedArtifacts(db)) {
    if (projectedBytes <= Number(targetBytes)) break;
    if (!inside(artifactRoot, artifact.artifact_path) || !fs.existsSync(artifact.artifact_path)) continue;
    selected.push(artifact);
    projectedBytes -= Number(artifact.file_size || 0);
  }
  if (!dryRun && selected.length) {
    const quarantineRoot = path.join(path.resolve(artifactRoot), '.quarantine', String(now).replaceAll(':', '-'));
    fs.mkdirSync(quarantineRoot, { recursive: true });
    const update = db.prepare("UPDATE director_artifacts SET status = 'archived', artifact_path = ? WHERE id = ? AND status = 'ready'");
    const moved = [];
    try {
      for (const artifact of selected) {
        const destination = path.join(quarantineRoot, `${artifact.id}${path.extname(artifact.artifact_path) || '.bin'}`);
        fs.renameSync(artifact.artifact_path, destination);
        moved.push({ artifact, destination });
      }
      db.transaction(() => moved.forEach(({ destination, artifact }) => update.run(destination, artifact.id)))();
    } catch (error) {
      for (const { artifact, destination } of moved.reverse()) {
        try { if (fs.existsSync(destination)) fs.renameSync(destination, artifact.artifact_path); } catch (_) {}
      }
      throw error;
    }
  }
  return { archivedArtifactIds: selected.map((artifact) => artifact.id), reclaimedBytes: usage.totalBytes - projectedBytes, projectedBytes, dryRun };
}

function createArtifactBundle(db, { artifactIds = [], outputPath, artifactRoot } = {}) {
  if (!outputPath || !artifactRoot) throw new Error('outputPath and artifactRoot are required');
  if (!Array.isArray(artifactIds) || !artifactIds.length) throw new Error('artifactIds are required');
  const zip = new AdmZip();
  const artifacts = [];
  for (const artifactId of expandArtifactClosure(db, [...new Set(artifactIds)])) {
    const artifact = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(artifactId);
    if (!artifact || !fs.existsSync(artifact.artifact_path) || !inside(artifactRoot, artifact.artifact_path)) throw new Error(`Artifact cannot be bundled: ${artifactId}`);
    const bytes = fs.readFileSync(artifact.artifact_path);
    const actualHash = hashBuffer(bytes);
    if (actualHash !== artifact.sha256) throw new Error(`Artifact hash mismatch: ${artifactId}`);
    const fileName = `artifacts/${artifact.id}${path.extname(artifact.artifact_path) || '.bin'}`;
    zip.addFile(fileName, bytes);
    artifacts.push({
      id: artifact.id,
      fileName,
      sha256: actualHash,
      fileSize: bytes.length,
      manifest: artifact.manifest_json ? JSON.parse(artifact.manifest_json) : null,
      record: artifact,
    });
  }
  const ids = artifacts.map((artifact) => artifact.id);
  const candidates = rowsForIds(db, 'director_candidates', 'artifact_id', ids);
  const groupIds = [...new Set(candidates.map((candidate) => candidate.group_id).filter(Boolean))];
  const selectedGroups = rowsForIds(db, 'director_candidate_groups', 'selected_artifact_id', ids);
  const candidateGroups = [...new Map([
    ...selectedGroups,
    ...rowsForIds(db, 'director_candidate_groups', 'id', groupIds),
  ].map((row) => [row.id, row])).values()];
  const jobIds = [...new Set(artifacts.map((artifact) => artifact.record.job_id).filter(Boolean))];
  const jobs = rowsForIds(db, 'director_jobs', 'id', jobIds);
  const anchors = db.prepare(`SELECT * FROM director_anchors
    WHERE source_artifact_id IN (${ids.map(() => '?').join(',')})
       OR derived_artifact_id IN (${ids.map(() => '?').join(',')})`).all(...ids, ...ids);
  const bundle = {
    version: 'director_artifact_bundle_v2',
    createdAt: new Date().toISOString(),
    artifacts,
    relationships: { jobs, candidateGroups, candidates, anchors },
  };
  validateBundleClosure(bundle);
  zip.addFile('bundle.json', Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'));
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  zip.writeZip(path.resolve(outputPath));
  return { outputPath: path.resolve(outputPath), ...bundle };
}

function restoreArtifactBundle({ db = null, bundlePath, restoreRoot } = {}) {
  if (!bundlePath || !restoreRoot) throw new Error('bundlePath and restoreRoot are required');
  const zip = new AdmZip(path.resolve(bundlePath));
  const manifestEntry = zip.getEntry('bundle.json');
  if (!manifestEntry) throw new Error('Artifact bundle is missing bundle.json');
  const bundle = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (!['director_artifact_bundle_v1', 'director_artifact_bundle_v2'].includes(bundle.version) || !Array.isArray(bundle.artifacts)) {
    throw new Error('Unsupported artifact bundle');
  }
  validateBundleClosure(bundle);
  const resolvedRoot = path.resolve(restoreRoot);
  const restored = [];
  const verified = [];
  for (const artifact of bundle.artifacts) {
    const entry = zip.getEntry(artifact.fileName);
    if (!entry) throw new Error(`Artifact bundle entry missing: ${artifact.id}`);
    const bytes = entry.getData();
    if (hashBuffer(bytes) !== artifact.sha256) throw new Error(`Artifact bundle hash mismatch: ${artifact.id}`);
    if (Number.isFinite(Number(artifact.fileSize)) && Number(artifact.fileSize) !== bytes.length) throw new Error(`Artifact bundle size mismatch: ${artifact.id}`);
    const outputPath = path.join(resolvedRoot, `${artifact.id}${path.extname(artifact.fileName) || '.bin'}`);
    const relativeOutput = path.relative(resolvedRoot, outputPath);
    if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('Artifact restore path escaped root');
    verified.push({ artifact, bytes, outputPath });
  }
  fs.mkdirSync(resolvedRoot, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(resolvedRoot, '.restore-'));
  const createdPaths = [];
  try {
    for (const { artifact, bytes, outputPath } of verified) {
      const stagedPath = path.join(stagingRoot, path.basename(outputPath));
      fs.writeFileSync(stagedPath, bytes, { flag: 'wx' });
      if (fs.existsSync(outputPath)) {
        if (hashBuffer(fs.readFileSync(outputPath)) !== artifact.sha256) throw new Error(`Artifact restore target conflict: ${artifact.id}`);
        fs.unlinkSync(stagedPath);
      } else {
        fs.renameSync(stagedPath, outputPath);
        createdPaths.push(outputPath);
      }
      restored.push({ ...artifact, artifactPath: outputPath });
    }
  } catch (error) {
    for (const createdPath of createdPaths.reverse()) {
      try { if (fs.existsSync(createdPath)) fs.unlinkSync(createdPath); } catch (_) {}
    }
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch (_) {}
    throw error;
  } finally {
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch (_) {}
  }
  const restoredRelationships = { jobs: 0, candidateGroups: 0, candidates: 0, anchors: 0 };
  if (db && bundle.version === 'director_artifact_bundle_v2') {
    const relationships = bundle.relationships || {};
    const restoredById = new Map(restored.map((artifact) => [artifact.id, artifact.artifactPath]));
    const persist = db.transaction(() => {
      for (const job of relationships.jobs || []) {
        const artifactPath = restoredById.get(job.artifact_id) || job.artifact_path;
        upsertRecord(db, 'director_jobs', { ...job, artifact_path: artifactPath });
        restoredRelationships.jobs += 1;
      }
      for (const artifact of restored) {
        const record = artifact.record;
        if (!record) throw new Error(`Artifact bundle record missing: ${artifact.id}`);
        const manifest = artifact.manifest ? { ...artifact.manifest, artifactPath: artifact.artifactPath } : null;
        upsertRecord(db, 'director_artifacts', {
          ...record,
          status: 'ready',
          artifact_path: artifact.artifactPath,
          sha256: artifact.sha256,
          file_size: artifact.fileSize,
          ...(manifest && { manifest_json: JSON.stringify(manifest) }),
        });
      }
      for (const [key, table] of [
        ['candidateGroups', 'director_candidate_groups'],
        ['candidates', 'director_candidates'],
        ['anchors', 'director_anchors'],
      ]) {
        for (const record of relationships[key] || []) {
          upsertRecord(db, table, record);
          restoredRelationships[key] += 1;
        }
      }
    });
    try {
      persist();
    } catch (error) {
      for (const createdPath of createdPaths) {
        try { if (fs.existsSync(createdPath)) fs.unlinkSync(createdPath); } catch (_) {}
      }
      throw error;
    }
  }
  return { version: bundle.version, artifacts: restored, relationships: restoredRelationships };
}

module.exports = { archiveUnreferencedArtifacts, createArtifactBundle, getArtifactUsage, restoreArtifactBundle };
