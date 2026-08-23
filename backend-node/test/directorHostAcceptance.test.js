const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  reconcileAndRetry,
  buildTimelineAcceptance,
  createEvidenceReport,
} = require('../scripts/directorHostAcceptance');

describe('Director host acceptance orchestration', () => {
  it('records running -> interrupted -> pending -> running recovery', () => {
    const calls = [];
    let reads = 0;
    const service = {
      reconcileRunningJobs() { calls.push('interrupted'); return 1; },
      getDirectorJob() {
        reads += 1;
        calls.push(reads === 1 ? 'running' : 'interrupted');
        return reads === 1
          ? { id: 'job-1', status: 'running', attempt_number: 1 }
          : { id: 'job-1', status: 'interrupted', attempt_number: 1 };
      },
      retryDirectorJob() { calls.push('retry'); return { id: 'job-1', status: 'pending', attempt_number: 1 }; },
      startDirectorJob() { calls.push('running'); return { id: 'job-1', status: 'running', attempt_number: 2 }; },
    };
    const result = reconcileAndRetry({}, 'job-1', {
      service,
      now: '2026-08-23T00:01:00.000Z',
    });
    assert.deepEqual(result.transitions, ['running', 'interrupted', 'pending', 'running']);
    assert.deepEqual(calls, ['running', 'interrupted', 'interrupted', 'retry', 'running']);
  });

  it('builds a real timeline command from two selected clips', () => {
    const timeline = {
      version: 'timeline_v1',
      output: { width: 864, height: 480, fps: 24, pixelFormat: 'yuv420p' },
      clips: [
        { artifactId: 'a', startTime: 0, duration: 2, sourceOffset: 0, sourceDuration: 2 },
        { artifactId: 'b', startTime: 2, duration: 2, sourceOffset: 0, sourceDuration: 2 },
      ],
      audioSources: [],
    };
    const result = buildTimelineAcceptance(timeline, {
      validate: input => input,
      create: input => ({ id: 'timeline-1', version: input.version, input_json: JSON.stringify(input) }),
      command: {
        args: ['-y', '-i', 'a.mp4', '-i', 'b.mp4', '-c:v', 'libx264', 'out.mp4'],
        command: 'ffmpeg ...',
      },
    });
    assert.equal(result.timelineId, 'timeline-1');
    assert.equal(result.version, 'timeline_v1');
    assert.equal(result.command.args.at(-1), 'out.mp4');
  });

  it('reports explicit gates and raw ffprobe metadata', () => {
    const report = createEvidenceReport({
      gates: { restartRetryOnHost: 'passed', timelineComposition: 'passed' },
      artifact: { sha256: 'a'.repeat(64), fileSize: 10 },
      ffprobe: { streams: [], format: { duration: '4' } },
    });
    assert.equal(report.gates.restart_retry_on_host, 'passed');
    assert.equal(report.gates.timeline_composition, 'passed');
    assert.deepEqual(report.timeline.ffprobe, { streams: [], format: { duration: '4' } });
  });
});
