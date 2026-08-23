#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const { loadRegistry } = require('../src/director/workflowRegistry');
const { createComfyUIClient } = require('../src/director/comfyuiClient');
const jobService = require('../src/director/directorJobService');
const candidateService = require('../src/director/candidateGroupService');
const timelineService = require('../src/director/timelineService');
const { createArtifactManifest, hashFile } = require('../src/director/artifactManifest');
const { processDirectorTimeline } = require('../src/services/videoMergeService');
const { getFfmpegPath, getFfprobePath } = require('../src/utils/ffmpegPath');

const DEFAULT_COMFYUI = 'http://127.0.0.1:8188';
const DEFAULT_REGISTRY = path.resolve(__dirname, '../configs/director-workflows.json');
const DIRECTOR_WORKFLOW_ID = 'h3-continuity-v1';

function parseArgs(argv) {
  const result = { force: false };
  const names = {
    '--comfyui': 'comfyui',
    '--output-dir': 'outputDir',
    '--evidence': 'evidence',
    '--source-artifact': 'sourceArtifact',
    '--source-sha256': 'sourceSha256',
    '--ffprobe': 'ffprobePath',
    '--ffmpeg': 'ffmpegPath',
    '--seed': 'seed',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      result.force = true;
      continue;
    }
    const key = names[arg];
    if (!key) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    if (key === 'seed') {
      const seed = Number(value);
      if (!Number.isSafeInteger(seed)) throw new Error('--seed requires an integer');
      result[key] = seed;
    } else {
      result[key] = value;
    }
    index += 1;
  }
  return result;
}

function ensureEvidencePathAvailable(evidencePath, { force = false } = {}) {
  if (fs.existsSync(evidencePath) && !force) {
    throw new Error(`Evidence path already exists: ${evidencePath}; use --force to overwrite`);
  }
}

function runCommand(file, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { ...options, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', error => resolve({ code: null, stdout, stderr, error: error.message }));
    child.once('exit', code => resolve({ code, stdout, stderr, error: null }));
  });
}

async function probeMedia(filePath, { ffprobePath = getFfprobePath(), runCommand: runner = runCommand } = {}) {
  const args = [
    '-v', 'error',
    '-show_entries', 'format=filename,format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,channels,sample_rate,channel_layout',
    '-of', 'json',
    filePath,
  ];
  const result = await runner(ffprobePath, args);
  if (result.code !== 0) throw new Error(`ffprobe failed for ${filePath}: ${result.stderr || result.error || result.code}`);
  try {
    const parsed = JSON.parse(result.stdout);
    if (!parsed || !Array.isArray(parsed.streams) || !parsed.format) throw new Error('raw ffprobe object requires streams and format');
    return parsed;
  } catch (error) {
    throw new Error(`ffprobe returned invalid JSON: ${error.message}`);
  }
}

function reconcileAndRetry(db, jobId, { service = jobService, now, leaseMs = 15 * 60 * 1000 } = {}) {
  const before = service.getDirectorJob(db, jobId);
  if (!before || before.status !== 'running') throw new Error('Director job must be running before restart reconciliation');
  const transitions = [before.status];
  const reconciled = service.reconcileRunningJobs(db, { now });
  if (reconciled !== 1) throw new Error(`Expected one interrupted job, got ${reconciled}`);
  const interrupted = service.getDirectorJob(db, jobId);
  if (!interrupted || interrupted.status !== 'interrupted') throw new Error('Restart reconciliation did not interrupt the running job');
  transitions.push(interrupted.status);
  const pending = service.retryDirectorJob(db, jobId, now);
  if (pending.status !== 'pending') throw new Error('Retry did not return the job to pending');
  transitions.push(pending.status);
  const running = service.startDirectorJob(db, jobId, { leaseMs, now });
  if (running.status !== 'running') throw new Error('Recovered job did not return to running');
  transitions.push(running.status);
  return { transitions, job: running };
}

function buildTimelineAcceptance(timelineInput, { validate, create, command } = {}) {
  if (typeof validate !== 'function' || typeof create !== 'function') throw new Error('timeline validate/create functions are required');
  const timeline = validate(timelineInput);
  const persisted = create(timeline);
  return {
    timelineId: persisted.id,
    version: persisted.version || timeline.version,
    timeline,
    command,
  };
}

function createEvidenceReport({
  startedAt = new Date().toISOString(),
  completedAt = new Date().toISOString(),
  host = {},
  workflow = {},
  recovery = {},
  completedJob = null,
  artifact = {},
  timeline = {},
  ffprobe = null,
  gates = {},
  errors = [],
} = {}) {
  return {
    schema: 'director-v1-host-acceptance',
    startedAt,
    completedAt,
    host,
    workflow,
    recovery: completedJob ? { ...recovery, job: completedJob } : recovery,
    artifact,
    timeline: { ...timeline, ffprobe },
    gates: {
      real_verified_h3: gates.realVerifiedH3 || 'pending',
      restart_retry_on_host: gates.restartRetryOnHost || 'pending',
      timeline_composition: gates.timelineComposition || 'pending',
      mp4_and_ffprobe: gates.mp4AndFfprobe || 'pending',
    },
    errors,
  };
}

function createFailureEvidence(progress = {}, error) {
  const gates = { ...(progress.gates || {}) };
  if (progress.currentGate) gates[progress.currentGate] = 'failed';
  return createEvidenceReport({
    ...progress,
    completedAt: new Date().toISOString(),
    gates,
    errors: [{ message: error.message, stack: error.stack }],
  });
}

function loadDirectorSchema(db) {
  const migration = fs.readFileSync(path.resolve(__dirname, '../migrations/23_director_v1.sql'), 'utf8');
  db.exec(migration);
}

function mediaShape(probe) {
  const stream = (probe.streams || []).find(item => item.codec_type === 'video') || probe.streams?.[0] || {};
  const fps = String(stream.r_frame_rate || stream.avg_frame_rate || '24/1').split('/');
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: fps.length === 2 ? Number(fps[0]) / Number(fps[1]) : Number(fps[0]),
    pixelFormat: stream.pix_fmt || 'yuv420p',
    duration: Number(probe.format?.duration || 0),
  };
}

function applyH3Inputs(prompt, inputs = {}) {
  const cloned = JSON.parse(JSON.stringify(prompt));
  const node = Object.values(cloned).find(item => item?.class_type === 'MiniMaxH3Director');
  if (!node) throw new Error('H3 workflow does not contain a MiniMaxH3Director node');
  const nodeInputs = node.inputs || (node.inputs = {});
  if (inputs.prompt) nodeInputs.global_prompt = String(inputs.prompt);
  if (Number.isInteger(inputs.seed)) nodeInputs.seed = inputs.seed;
  if (Number.isInteger(inputs.width)) nodeInputs.width = inputs.width;
  if (Number.isInteger(inputs.height)) nodeInputs.height = inputs.height;
  let timelineData = {};
  try { timelineData = JSON.parse(nodeInputs.timeline_data || '{}'); } catch (_) { timelineData = {}; }
  timelineData.output = {
    ...(timelineData.output || {}),
    continuityEnabled: inputs.continuityEnabled === true,
    continuityOverlapFrames: Number.isInteger(inputs.continuityOverlapFrames) ? inputs.continuityOverlapFrames : 0,
  };
  timelineData.global = { ...(timelineData.global || {}), prompt: inputs.prompt || timelineData.global?.prompt || nodeInputs.global_prompt };
  nodeInputs.timeline_data = JSON.stringify(timelineData);
  return cloned;
}

function validateH3Result({ queue, history, ffprobe, width = 864, height = 480 } = {}) {
  const historyStatus = history?.status || {};
  if (historyStatus.status_str !== 'success' || historyStatus.completed !== true) throw new Error('H3 output history did not complete successfully');
  if (queue?.node_errors && Object.keys(queue.node_errors).length > 0) throw new Error('H3 output contains node errors');
  const prompt = history?.prompt?.[2] || {};
  const h3NodeIds = Object.entries(prompt)
    .filter(([, node]) => node?.class_type === 'MiniMaxH3Director')
    .map(([nodeId]) => String(nodeId));
  const cachedNodeIds = new Set((historyStatus.messages || [])
    .filter(message => message?.[0] === 'execution_cached')
    .flatMap(message => message?.[1]?.nodes || [])
    .map(String));
  if (h3NodeIds.some(nodeId => cachedNodeIds.has(nodeId))) {
    throw new Error('H3 generation node was cached; fresh host inference is required');
  }
  const video = (ffprobe?.streams || []).find(stream => stream.codec_type === 'video');
  const audio = (ffprobe?.streams || []).find(stream => stream.codec_type === 'audio');
  if (!video || video.codec_name !== 'h264' || Number(video.width) !== width || Number(video.height) !== height) {
    throw new Error('H3 output video stream does not match expected H.264 dimensions');
  }
  if (!audio || audio.codec_name !== 'aac') throw new Error('H3 output audio stream is missing or not AAC');
  if (!(Number(ffprobe?.format?.duration) > 0)) throw new Error('H3 output duration is invalid');
  return { status: 'passed', video, audio, duration: Number(ffprobe.format.duration) };
}

function validateTimelineResult({ outputSha256, ffprobe, expectedDuration, tolerance = 0.1 } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(outputSha256 || ''))) throw new Error('Timeline output hash is missing or invalid');
  const video = (ffprobe?.streams || []).find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('Timeline output video stream is missing');
  const duration = Number(ffprobe?.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - Number(expectedDuration)) > tolerance) {
    throw new Error(`Timeline output duration mismatch: expected ${expectedDuration}, got ${duration}`);
  }
  return { status: 'passed', duration, expectedDuration: Number(expectedDuration) };
}

function validateSourceArtifact({ actualSha256, expectedSha256 } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(actualSha256 || ''))) throw new Error('Source artifact hash is invalid');
  if (expectedSha256 && String(actualSha256).toLowerCase() !== String(expectedSha256).toLowerCase()) {
    throw new Error(`Source artifact hash mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  return { status: 'passed', sha256: String(actualSha256).toLowerCase() };
}

async function executeAcceptance(options = {}, progress = {}) {
  const startedAt = progress.startedAt || new Date().toISOString();
  progress.startedAt = startedAt;
  progress.gates ||= {
    realVerifiedH3: 'pending',
    restartRetryOnHost: 'pending',
    timelineComposition: 'pending',
    mp4AndFfprobe: 'pending',
  };
  progress.currentGate ||= 'realVerifiedH3';
  const comfyui = options.comfyui || DEFAULT_COMFYUI;
  const outputDir = path.resolve(options.outputDir || path.join(process.cwd(), 'director-v1-acceptance-output'));
  const evidencePath = path.resolve(options.evidence || path.join(process.cwd(), 'director-v1-host-acceptance.json'));
  const sourceArtifact = options.sourceArtifact ? path.resolve(options.sourceArtifact) : null;
  const ffmpegPath = options.ffmpegPath || getFfmpegPath();
  const ffprobePath = options.ffprobePath || getFfprobePath();
  const seed = Number.isSafeInteger(options.seed) ? options.seed : crypto.randomInt(0, 2_147_483_648);
  ensureEvidencePathAvailable(evidencePath, { force: options.force });
  if (!sourceArtifact || !fs.existsSync(sourceArtifact)) throw new Error(`Existing source artifact is required: ${sourceArtifact || '(missing)'}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const statsResponse = await (options.fetchImpl || globalThis.fetch)(`${comfyui.replace(/\/$/, '')}/system_stats`);
  if (!statsResponse.ok) throw new Error(`ComfyUI /system_stats returned HTTP ${statsResponse.status}`);
  const stats = await statsResponse.json();
  progress.host = {
    baseUrl: comfyui,
    systemStatsStatus: statsResponse.status,
    comfyuiVersion: stats.system?.comfyui_version || null,
    gpu: stats.devices?.[0]?.name || null,
  };
  const registry = loadRegistry(options.registryPath || DEFAULT_REGISTRY);
  const workflow = registry.workflows.find(item => item.id === DIRECTOR_WORKFLOW_ID);
  if (!workflow) throw new Error(`Verified workflow not found: ${DIRECTOR_WORKFLOW_ID}`);
  progress.workflow = { id: workflow.id, sha256: workflow.workflowSha256, inputs: { seed } };
  const workflowDocument = JSON.parse(fs.readFileSync(workflow.workflowPath, 'utf8'));
  const db = options.db || new Database(':memory:');
  loadDirectorSchema(db);
  const service = options.jobService || jobService;
  const now = new Date().toISOString();
  const job = service.createDirectorJob(db, {
    input: { prompt: 'director host acceptance', seed, continuityEnabled: true, continuityOverlapFrames: 22 },
    workflowId: workflow.id,
    workflowVersion: workflow.workflowSha256,
    maxAttempts: 2,
    now,
  });
  service.startDirectorJob(db, job.id, { leaseMs: 1, now: '2026-08-23T00:00:00.000Z' });
  progress.currentGate = 'restartRetryOnHost';
  const recovery = reconcileAndRetry(db, job.id, { service, now: new Date(Date.now() + 60_000).toISOString() });
  progress.recovery = recovery;
  progress.gates.restartRetryOnHost = recovery.transitions.join('->') === 'running->interrupted->pending->running' ? 'passed' : 'failed';
  progress.currentGate = 'realVerifiedH3';

  const client = options.client || createComfyUIClient({ baseUrl: comfyui, fetchImpl: options.fetchImpl || globalThis.fetch, outputDir, pollIntervalMs: options.pollIntervalMs ?? 5000, timeoutMs: options.timeoutMs ?? 30 * 60 * 1000 });
  const h3Inputs = { prompt: 'director host acceptance', seed, continuityEnabled: true, continuityOverlapFrames: 22, width: 864, height: 480 };
  const generated = await client.runWorkflow({
    registry,
    workflowId: workflow.id,
    prompt: applyH3Inputs(workflowDocument.prompt, h3Inputs),
    inputs: h3Inputs,
    outputFileName: 'director-host-acceptance-h3.mp4',
  });
  const generatedProbe = await probeMedia(generated.artifactPath, { ffprobePath, runCommand: options.runCommand });
  progress.workflow = {
    ...progress.workflow,
    promptId: generated.promptId,
    queue: generated.queue,
    history: generated.history,
    inputs: h3Inputs,
  };
  progress.artifact = {
    path: generated.artifactPath,
    sha256: generated.sha256,
    fileSize: generated.fileSize,
    ffprobe: generatedProbe,
  };
  const h3Validation = validateH3Result({ queue: generated.queue, history: generated.history, ffprobe: generatedProbe });
  progress.workflow.validation = h3Validation;
  progress.gates.realVerifiedH3 = h3Validation.status;
  const completedJob = service.succeedDirectorJob(db, job.id, {
    artifactPath: generated.artifactPath,
    ffprobe: generatedProbe,
    metadata: { promptId: generated.promptId, workflowId: generated.workflowId, workflowSha256: generated.workflowSha256 },
  });
  progress.completedJob = completedJob;
  const generatedArtifact = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(completedJob.artifact_id);

  const sourceJob = service.createDirectorJob(db, { input: { imported: true, sourceArtifact }, workflowId: workflow.id, maxAttempts: 1 });
  service.startDirectorJob(db, sourceJob.id, { leaseMs: 60_000 });
  const sourceProbe = await probeMedia(sourceArtifact, { ffprobePath, runCommand: options.runCommand });
  const sourceHash = hashFile(sourceArtifact).sha256;
  const sourceValidation = validateSourceArtifact({ actualSha256: sourceHash, expectedSha256: options.sourceSha256 });
  progress.workflow.sourceValidation = sourceValidation;
  validateH3Result({ queue: { node_errors: {} }, history: { status: { status_str: 'success', completed: true } }, ffprobe: sourceProbe, width: mediaShape(sourceProbe).width, height: mediaShape(sourceProbe).height });
  const sourceCompleted = service.succeedDirectorJob(db, sourceJob.id, { artifactPath: sourceArtifact, ffprobe: sourceProbe, metadata: { imported: true } });
  const sourceDbArtifact = db.prepare('SELECT * FROM director_artifacts WHERE id = ?').get(sourceCompleted.artifact_id);

  const selectedArtifacts = [sourceDbArtifact, generatedArtifact].map((artifact, index) => {
    const group = candidateService.createCandidateGroup(db, { shotId: `host-acceptance-${index}`, candidates: [{ artifactId: artifact.id, jobId: artifact.job_id }] });
    candidateService.startCandidateGroup(db, group.id);
    const review = candidateService.moveCandidateGroupToReview(db, group.id);
    const candidate = review.candidates[0];
    return candidateService.selectCandidate(db, group.id, candidate.id, { selectedBy: 'host-acceptance' });
  });
  const sourceMedia = mediaShape(sourceProbe);
  const clipDuration = Math.min(4, sourceMedia.duration, mediaShape(generatedProbe).duration);
  const timelineInput = {
    version: 'timeline_v1',
    output: { width: sourceMedia.width, height: sourceMedia.height, fps: sourceMedia.fps, pixelFormat: sourceMedia.pixelFormat },
    clips: [
      { artifactId: selectedArtifacts[0].selected_artifact_id, startTime: 0, duration: clipDuration, sourceOffset: 0, sourceDuration: clipDuration },
      { artifactId: selectedArtifacts[1].selected_artifact_id, startTime: clipDuration, duration: clipDuration, sourceOffset: 0, sourceDuration: clipDuration },
    ],
    audioSources: [],
  };
  const timeline = timelineService.validateTimeline(db, timelineInput);
  const timelineOutput = path.join(outputDir, 'director-host-acceptance-timeline.mp4');
  const timelineRow = timelineService.createTimeline(db, timeline, { outputPath: timelineOutput, ffmpegPath });
  const timelineCommand = timelineService.buildFfmpegCommand(timeline, { ffmpegPath, outputPath: timelineOutput });
  progress.currentGate = 'timelineComposition';
  progress.timeline = {
    id: timelineRow.id,
    outputPath: timelineOutput,
    clips: timeline.clips,
    command: timelineCommand,
  };
  const timelineResult = await processDirectorTimeline(db, null, timelineRow.id, {
    runProcess: options.runProcess || options.runCommand,
    ffmpegPath,
    ffprobePath,
  });
  if (timelineResult.status !== 'completed') throw new Error('timeline_v1 composition failed');
  progress.gates.timelineComposition = 'passed';
  progress.currentGate = 'mp4AndFfprobe';
  const timelineProbe = JSON.parse(timelineResult.ffprobe_json);
  progress.timeline = {
    ...progress.timeline,
    outputSha256: timelineResult.output_sha256,
  };
  progress.ffprobe = timelineProbe;
  const timelineValidation = validateTimelineResult({
    outputSha256: timelineResult.output_sha256,
    ffprobe: timelineProbe,
    expectedDuration: timeline.totalDuration,
  });
  progress.timeline = {
    ...progress.timeline,
    validation: timelineValidation,
  };
  progress.gates.mp4AndFfprobe = timelineValidation.status;
  progress.currentGate = null;
  const report = createEvidenceReport({
    ...progress,
    completedAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!options.db) db.close();
  return report;
}

async function runAcceptance(options = {}) {
  const progress = {
    startedAt: new Date().toISOString(),
    gates: { realVerifiedH3: 'pending', restartRetryOnHost: 'pending', timelineComposition: 'pending', mp4AndFfprobe: 'pending' },
    currentGate: 'realVerifiedH3',
  };
  try {
    return await executeAcceptance(options, progress);
  } catch (error) {
    const evidencePath = path.resolve(options.evidence || path.join(process.cwd(), 'director-v1-host-acceptance.json'));
    if (options.force || !fs.existsSync(evidencePath)) {
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      fs.writeFileSync(evidencePath, `${JSON.stringify(createFailureEvidence(progress, error), null, 2)}\n`, 'utf8');
    }
    throw error;
  }
}

if (require.main === module) {
  runAcceptance(parseArgs(process.argv.slice(2)))
    .then(report => {
      const evidencePath = process.argv.includes('--evidence') ? process.argv[process.argv.indexOf('--evidence') + 1] : 'director-v1-host-acceptance.json';
      process.stdout.write(`${JSON.stringify({ ok: true, evidence: evidencePath, gates: report.gates }, null, 2)}\n`);
    })
    .catch(error => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  ensureEvidencePathAvailable,
  probeMedia,
  reconcileAndRetry,
  buildTimelineAcceptance,
  createEvidenceReport,
  createFailureEvidence,
  applyH3Inputs,
  validateH3Result,
  validateTimelineResult,
  validateSourceArtifact,
  runAcceptance,
  runCommand,
};
