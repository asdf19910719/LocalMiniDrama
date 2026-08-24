const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createArtifactManifest } = require('./artifactManifest');

const execFileAsync = promisify(execFile);
const REFERENCE_ROLES = new Set(['state', 'composition', 'identity', 'motion']);
const DERIVED_OPERATIONS = new Set(['extract_frame', 'upscale_2x', 'crop', 'composition_edit', 'line_art']);

function id() { return crypto.randomUUID(); }
function nowIso(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function defaultFrameExtractor({ sourcePath, outputPath, frameNumber, ffmpegPath = 'ffmpeg' }) {
  await execFileAsync(ffmpegPath, [
    '-y', '-i', sourcePath, '-vf', `select=eq(n\\,${frameNumber})`, '-frames:v', '1', outputPath,
  ]);
}

function derivedImageFilter(operation, parameters = {}) {
  if (operation === 'upscale_2x') return 'scale=iw*2:ih*2:flags=lanczos';
  if (operation === 'line_art') {
    const low = Number(parameters.edgeLow ?? 0.1);
    const high = Number(parameters.edgeHigh ?? 0.4);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high <= low) {
      throw new Error('line_art edge thresholds must be finite and ordered');
    }
    return `format=gray,edgedetect=mode=colormix:low=${low}:high=${high}`;
  }
  if (operation === 'crop' || operation === 'composition_edit') {
    const width = Number(parameters.width);
    const height = Number(parameters.height);
    const x = Number(parameters.x ?? 0);
    const y = Number(parameters.y ?? 0);
    if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0 || x < 0 || y < 0) {
      throw new Error(`${operation} requires positive width/height and non-negative x/y`);
    }
    const crop = `crop=${Math.round(width)}:${Math.round(height)}:${Math.round(x)}:${Math.round(y)}`;
    if (operation === 'crop' || !parameters.outputWidth || !parameters.outputHeight) return crop;
    const outputWidth = Number(parameters.outputWidth);
    const outputHeight = Number(parameters.outputHeight);
    if (![outputWidth, outputHeight].every(Number.isFinite) || outputWidth <= 0 || outputHeight <= 0) {
      throw new Error('composition_edit output dimensions must be positive');
    }
    return `${crop},scale=${Math.round(outputWidth)}:${Math.round(outputHeight)}:flags=lanczos`;
  }
  throw new Error(`Unsupported derived image operation: ${operation}`);
}

async function defaultDerivedImageProcessor({ operation, inputPath, outputPath, parameters = {}, ffmpegPath = 'ffmpeg' }) {
  await execFileAsync(ffmpegPath, [
    '-y', '-i', inputPath, '-vf', derivedImageFilter(operation, parameters), '-frames:v', '1', outputPath,
  ]);
}

function selectedSource(db, artifactId) {
  const artifact = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(artifactId);
  if (!artifact || artifact.status !== 'ready') throw new Error('Source artifact must be ready');
  const selected = db.prepare(`SELECT 1 FROM director_candidate_groups
    WHERE selected_artifact_id = ? AND status = 'selected' LIMIT 1`).get(artifactId);
  if (!selected) throw new Error('Source artifact must be selected before creating an anchor');
  return artifact;
}

async function createContinuityAnchor(db, {
  artifactId,
  frameNumber,
  referenceRole,
  referenceUse = 'state_anchor',
  promptLabel = null,
  isFirstFrame = false,
  frameExtractor = defaultFrameExtractor,
  derivedImageProcessor = defaultDerivedImageProcessor,
  operation = 'extract_frame',
  ffprobe = null,
  outputDir,
  ffmpegPath,
  parameters = {},
  now,
} = {}) {
  if (!Number.isInteger(frameNumber) || frameNumber < 0) throw new Error('frameNumber must be a non-negative integer');
  if (!REFERENCE_ROLES.has(referenceRole)) throw new Error(`Invalid reference role: ${referenceRole}`);
  if (!String(referenceUse || '').trim()) throw new Error('referenceUse is required');
  if (isFirstFrame && referenceUse === 'composition_only') {
    throw new Error('composition_only cannot be used as an I2V first frame');
  }
  const resolvedOperation = parameters.operation || operation;
  if (!DERIVED_OPERATIONS.has(resolvedOperation)) throw new Error(`Unsupported derived image operation: ${resolvedOperation}`);
  const source = selectedSource(db, artifactId);
  const createdAt = nowIso(now);
  const targetDir = outputDir || path.dirname(source.artifact_path);
  fs.mkdirSync(targetDir, { recursive: true });
  const outputPath = path.join(targetDir, `anchor-${source.id}-${frameNumber}-${id()}.png`);
  const extractedPath = resolvedOperation === 'extract_frame'
    ? outputPath
    : path.join(targetDir, `anchor-source-${source.id}-${frameNumber}-${id()}.png`);
  try {
    await frameExtractor({
      sourcePath: source.artifact_path,
      outputPath: extractedPath,
      frameNumber,
      ffmpegPath,
    });
    if (resolvedOperation !== 'extract_frame') {
      await derivedImageProcessor({
        operation: resolvedOperation,
        inputPath: extractedPath,
        outputPath,
        parameters,
        ffmpegPath,
      });
    }
  } finally {
    if (extractedPath !== outputPath) fs.rmSync(extractedPath, { force: true });
  }
  if (!fs.existsSync(outputPath)) throw new Error('Frame extractor did not create an output artifact');
  const manifest = createArtifactManifest({
    artifactPath: outputPath,
    parentArtifactId: source.id,
    kind: 'image',
    ffprobe,
    metadata: { operation: resolvedOperation, frameNumber, referenceRole, referenceUse, ...parameters },
    now: createdAt,
  });
  const derivedId = id();
  const anchorId = id();
  const versionRow = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM director_artifacts WHERE job_id = ?').get(source.job_id);
  const version = Number(versionRow.version) + 1;
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO director_artifacts
      (id, job_id, attempt_number, version, status, artifact_path, parent_artifact_id,
       sha256, file_size, ffprobe_json, manifest_json, created_at, ready_at)
      VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      derivedId, source.job_id, source.attempt_number, version, outputPath, source.id,
      manifest.sha256, manifest.fileSize, JSON.stringify(ffprobe), manifest.manifestJson, createdAt, createdAt
    );
    db.prepare(`INSERT INTO director_anchors
      (id, source_artifact_id, derived_artifact_id, frame_number, reference_role, reference_use,
       prompt_label, source_sha256, parameters_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      anchorId, source.id, derivedId, frameNumber, referenceRole, referenceUse, promptLabel,
      source.sha256, JSON.stringify({ ...parameters, frameNumber, referenceRole, referenceUse }), createdAt
    );
  });
  transaction();
  return db.prepare('SELECT * FROM director_anchors WHERE id = ?').get(anchorId);
}

module.exports = {
  REFERENCE_ROLES,
  DERIVED_OPERATIONS,
  createContinuityAnchor,
  defaultFrameExtractor,
  defaultDerivedImageProcessor,
  derivedImageFilter,
};
