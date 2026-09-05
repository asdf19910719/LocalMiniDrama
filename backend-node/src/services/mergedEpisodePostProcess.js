/**
 * 整集合并后的后处理：对白 TTS 轨、解说旁白轨+SRT、右下角文字水印（可组合）。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getFfmpegPath, getFfprobePath } = require('../utils/ffmpegPath');
const { buildEpisodeAudioMixPlan } = require('./episodeAudioMixService');
const { normalizeEpisodeAudioPlan, normalizeStoryboardAudioDescription } = require('./storyboardAvContractService');

function resolveStorageLocalFile(storageRoot, storedPath, { mustExist = true } = {}) {
  if (storedPath == null || !String(storedPath).trim()) return null;
  const raw = String(storedPath).trim();
  if (path.isAbsolute(raw)) {
    const error = new Error('AUDIO_PATH_OUTSIDE_STORAGE: audio path must be storage-relative');
    error.code = 'AUDIO_PATH_OUTSIDE_STORAGE';
    throw error;
  }
  const root = path.resolve(storageRoot);
  const candidate = path.resolve(root, raw.replace(/^[/\\]+/, ''));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('AUDIO_PATH_OUTSIDE_STORAGE: audio path escapes storage root');
    error.code = 'AUDIO_PATH_OUTSIDE_STORAGE';
    throw error;
  }
  if (!fs.existsSync(candidate)) return mustExist ? null : candidate;
  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(candidate);
  const realRelative = path.relative(realRoot, realCandidate);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    const error = new Error('AUDIO_PATH_OUTSIDE_STORAGE: audio path resolves outside storage root');
    error.code = 'AUDIO_PATH_OUTSIDE_STORAGE';
    throw error;
  }
  return realCandidate;
}

function resolveSpeechOwner(row, episodeAudioPlan, layer) {
  let shotAudio = null;
  try { shotAudio = normalizeStoryboardAudioDescription(row?.audio_description); } catch (_) {}
  return shotAudio?.speech_override?.[`${layer}_owner`]
    || episodeAudioPlan?.speech?.[`${layer}_owner`]
    || (layer === 'dialogue' ? 'h3_native' : 'post_tts');
}

function ffprobeDurationSec(filePath) {
  const probe = getFfprobePath();
  const r = spawnSync(
    probe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  if (r.status !== 0) return null;
  const d = parseFloat(String(r.stdout || '').trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function formatSrtTimestamp(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const z = Math.floor(ms % 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(z).padStart(3, '0')}`;
}

function buildAtempoChain(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  if (Math.abs(factor - 1) < 0.002) return null;
  const parts = [];
  let f = factor;
  while (f > 2.001) {
    parts.push('atempo=2');
    f /= 2;
  }
  while (f < 0.499) {
    parts.push('atempo=0.5');
    f /= 0.5;
  }
  parts.push(`atempo=${Math.min(2, Math.max(0.5, f))}`);
  return parts.join(',');
}

function escapeFfmpegPath(absPath) {
  let s = path.resolve(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = s.replace(/^([A-Za-z]):/, '$1\\:');
  return s.replace(/'/g, "\\'");
}

function runFfmpeg(args, log, tag) {
  const bin = getFfmpegPath();
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) {
    log.warn('merged post: ffmpeg spawn', { tag, error: r.error.message });
    return false;
  }
  if (r.status !== 0) {
    log.warn('merged post: ffmpeg failed', { tag, stderr: r.stderr?.slice(-1000) });
    return false;
  }
  return true;
}

function writeSilenceMp3(slotSec, outPath, log) {
  return runFfmpeg(
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '6', outPath],
    log,
    'silence'
  );
}

function fitAudioToSlot(inputPath, slotSec, outPath, log) {
  const d = ffprobeDurationSec(inputPath);
  if (d == null || d <= 0.01) return false;
  const eps = 0.06;
  if (d > slotSec + eps) {
    const factor = d / slotSec;
    const chain = buildAtempoChain(factor);
    const af = chain || 'anull';
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', af, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_speed'
    );
  }
  if (d < slotSec - eps) {
    const pad = slotSec - d;
    return runFfmpeg(
      ['-y', '-i', inputPath, '-af', `apad=pad_dur=${pad}`, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_pad'
    );
  }
  try {
    fs.copyFileSync(inputPath, outPath);
    return true;
  } catch (_) {
    return runFfmpeg(
      ['-y', '-i', inputPath, '-t', String(slotSec), '-c:a', 'libmp3lame', '-q:a', '4', outPath],
      log,
      'fit_copy'
    );
  }
}

function amixTwoTracks(pathA, pathB, slotSec, outPath, log) {
  return runFfmpeg(
    [
      '-y', '-i', pathA, '-i', pathB,
      '-filter_complex', `[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      '-map', '[aout]',
      '-t', String(slotSec),
      '-c:a', 'libmp3lame', '-q:a', '4',
      outPath,
    ],
    log,
    'amix_seg'
  );
}

function transitionDurationMs(scene) {
  const transition = scene?.transition && typeof scene.transition === 'object' ? scene.transition : {};
  if (String(transition.type || 'cut').toLowerCase() === 'cut') return 0;
  const seconds = Number(transition.duration ?? transition.duration_seconds);
  const milliseconds = Number(transition.duration_ms);
  const value = Number.isFinite(seconds) ? seconds * 1000 : (Number.isFinite(milliseconds) ? milliseconds : 0);
  return Math.max(0, Math.round(value));
}

function segmentStartTimesMs(scenes) {
  let cursor = 0;
  return (Array.isArray(scenes) ? scenes : []).map((scene) => {
    const start = cursor;
    const duration = Math.max(200, Math.round((Number(scene?.duration) || 5) * 1000));
    cursor += Math.max(0, duration - transitionDurationMs(scene));
    return start;
  });
}

function buildSpeechTimelineFilter(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  const starts = segmentStartTimesMs(list);
  const filters = list.map((scene, index) => {
    const duration = Math.max(0.2, Number(scene?.duration) || 5);
    return `[${index}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,adelay=${starts[index]}:all=1[seg${index}]`;
  });
  if (list.length === 1) filters.push('[seg0]anull[aout]');
  else if (list.length > 1) filters.push(`${list.map((_, index) => `[seg${index}]`).join('')}amix=inputs=${list.length}:duration=longest:normalize=0[aout]`);
  return { filterComplex: filters.join(';'), startTimesMs: starts };
}

function mixSpeechTimeline(segmentPaths, scenes, videoDuration, outPath, log) {
  const timeline = buildSpeechTimelineFilter(scenes);
  const args = ['-y'];
  for (const segment of segmentPaths) args.push('-i', segment);
  args.push(
    '-filter_complex', timeline.filterComplex,
    '-map', '[aout]', '-t', String(videoDuration),
    '-c:a', 'libmp3lame', '-q:a', '4', outPath,
  );
  return runFfmpeg(args, log, 'speech_timeline');
}

function getDrawtextFontOption() {
  const candidates = [];
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    candidates.push(
      path.join(root, 'Fonts', 'msyh.ttc'),
      path.join(root, 'Fonts', 'msyhbd.ttc'),
      path.join(root, 'Fonts', 'simhei.ttf')
    );
  }
  candidates.push('/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      return `:fontfile='${escapeFfmpegPath(p)}'`;
    }
  }
  return '';
}

/**
 * @param {object} mergeOpts — burn_dialogue_audio, burn_narration_subtitles, watermark_text
 */
async function runMergedEpisodePostProcess(db, log, opts) {
  const { mergedAbsPath, storageRoot, scenes, episodeId, mergeOpts = {}, preserveInput = false } = opts;
  const wantDial = !!mergeOpts.burn_dialogue_audio;
  const wantNarr = !!mergeOpts.burn_narration_subtitles;
  let episodeAudioPlan = normalizeEpisodeAudioPlan(null);
  try {
    const episode = db.prepare('SELECT audio_plan FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
    episodeAudioPlan = normalizeEpisodeAudioPlan(episode?.audio_plan);
  } catch (_) {}
  const watermarkText = (mergeOpts.watermark_text && String(mergeOpts.watermark_text).trim())
    ? String(mergeOpts.watermark_text).trim().slice(0, 200)
    : '';

  if (!mergedAbsPath || !fs.existsSync(mergedAbsPath) || !Array.isArray(scenes) || scenes.length === 0) {
    return { ok: false, error: '无效合成参数' };
  }

  const storyboardRows = scenes.map((scene) => db.prepare(
    'SELECT dialogue, narration, audio_local_path, narration_audio_local_path, audio_description FROM storyboards WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(scene.scene_id)) || null);
  const includeDialogueTrack = wantDial && storyboardRows.some((row) => resolveSpeechOwner(row, episodeAudioPlan, 'dialogue') === 'post_tts');
  const includeNarrationTrack = wantNarr && storyboardRows.some((row) => (
    resolveSpeechOwner(row, episodeAudioPlan, 'narration') === 'post_tts'
    && row?.narration && String(row.narration).trim()
  ));
  const needSpeech = includeDialogueTrack || includeNarrationTrack;
  const needAudio = needSpeech || episodeAudioPlan.bgm.mode === 'episode_track';
  const hasNarrationSubtitles = wantNarr && storyboardRows.some((row) => row?.narration && String(row.narration).trim());
  if (!needAudio && !wantNarr && !watermarkText) {
    return { ok: false, error: 'NO_POST_OPTS' };
  }
  if (!needAudio && wantNarr && !hasNarrationSubtitles && !watermarkText) {
    return {
      ok: true,
      noOp: true,
      relativePath: path.relative(storageRoot, mergedAbsPath).replace(/\\/g, '/'),
    };
  }

  const videoDur = ffprobeDurationSec(mergedAbsPath);
  if (videoDur == null) {
    return { ok: false, error: '无法读取合成视频时长' };
  }

  const tempRoot = path.join(require('os').tmpdir(), 'drama-merged-post', String(episodeId || 0), String(Date.now()));
  fs.mkdirSync(tempRoot, { recursive: true });
  const ttsService = require('./ttsService');

  try {
    let alignedAudioPath = null;
    let srtPath = null;
    let srtLines = [];

    if (needSpeech || wantNarr) {
      let srtIdx = 1;
      const segmentFiles = [];
      const startTimes = segmentStartTimesMs(scenes);

      for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i];
        const sbId = Number(sc.scene_id);
        const slotSec = Math.max(0.2, Number(sc.duration) || 5);
        const row = storyboardRows[i];
        const dialogueOwnedByPost = resolveSpeechOwner(row, episodeAudioPlan, 'dialogue') === 'post_tts';
        const narrationOwnedByPost = resolveSpeechOwner(row, episodeAudioPlan, 'narration') === 'post_tts';

        const narrText = (row?.narration && String(row.narration).trim()) ? String(row.narration).trim() : '';
        if (wantNarr && narrText) {
          const durMs = Math.round(slotSec * 1000);
          srtLines.push(String(srtIdx++), `${formatSrtTimestamp(startTimes[i])} --> ${formatSrtTimestamp(startTimes[i] + durMs)}`, narrText, '');
        }

        if (!needSpeech) continue;

        const diaFit = path.join(tempRoot, `dia_fit_${i}.mp3`);
        const narrFit = path.join(tempRoot, `narr_fit_${i}.mp3`);
        const segOut = path.join(tempRoot, `seg_mix_${i}.mp3`);

        if (includeDialogueTrack) {
          const rel = row?.audio_local_path && String(row.audio_local_path).trim();
          const srcAbs = dialogueOwnedByPost ? resolveStorageLocalFile(storageRoot, rel) : null;
          if (srcAbs) {
            if (!fitAudioToSlot(srcAbs, slotSec, diaFit, log)) {
              return { ok: false, error: `对白配音时长对齐失败 #${i}` };
            }
          } else if (!writeSilenceMp3(slotSec, diaFit, log)) {
            return { ok: false, error: `对白静音片段失败 #${i}` };
          }
        }

        if (includeNarrationTrack) {
          if (!narrationOwnedByPost || !narrText) {
            if (!writeSilenceMp3(slotSec, narrFit, log)) {
              return { ok: false, error: `旁白静音片段失败 #${i}` };
            }
          } else {
            const segRaw = path.join(tempRoot, `narr_raw_${i}.mp3`);
            let narrAbs = resolveStorageLocalFile(storageRoot, row?.narration_audio_local_path);
            if (!narrAbs) {
              let synth;
              try {
                synth = await ttsService.synthesize(db, log, {
                  text: narrText,
                  storyboard_id: null,
                  storage_base: storageRoot,
                });
              } catch (e) {
                log.warn('merged post: narration TTS failed', { segment: i, error: e.message });
                return { ok: false, error: `解说旁白 TTS 失败：${e.message}` };
              }
              narrAbs = resolveStorageLocalFile(storageRoot, synth.local_path);
            }
            if (!narrAbs) return { ok: false, error: '旁白 TTS 文件不存在' };
            try {
              fs.copyFileSync(narrAbs, segRaw);
            } catch (_) {
              return { ok: false, error: '复制旁白 TTS 失败' };
            }
            if (!fitAudioToSlot(segRaw, slotSec, narrFit, log)) {
              return { ok: false, error: `旁白时长对齐失败 #${i}` };
            }
          }
        }

        if (includeDialogueTrack && includeNarrationTrack) {
          if (!amixTwoTracks(diaFit, narrFit, slotSec, segOut, log)) {
            return { ok: false, error: `对白与旁白混音失败 #${i}` };
          }
        } else if (includeDialogueTrack) {
          try {
            fs.copyFileSync(diaFit, segOut);
          } catch (_) {
            return { ok: false, error: `对白片段复制失败 #${i}` };
          }
        } else if (includeNarrationTrack) {
          try {
            fs.copyFileSync(narrFit, segOut);
          } catch (_) {
            return { ok: false, error: `旁白片段复制失败 #${i}` };
          }
        }

        segmentFiles.push(segOut);
      }

      if (needSpeech) {
        alignedAudioPath = path.join(tempRoot, 'aligned_mix.mp3');
        if (!mixSpeechTimeline(segmentFiles, scenes, videoDur, alignedAudioPath, log)) {
          return { ok: false, error: '音轨按转场时间线对齐失败' };
        }
      }

      if (wantNarr && srtLines.length > 0) {
        const baseName = path.basename(mergedAbsPath, path.extname(mergedAbsPath));
        srtPath = path.join(path.dirname(mergedAbsPath), `${baseName}_narration.srt`);
        fs.writeFileSync(srtPath, `\uFEFF${srtLines.join('\n')}\n`, 'utf8');
      }
    }

    const baseName = path.basename(mergedAbsPath, path.extname(mergedAbsPath));
    const outAbs = path.join(path.dirname(mergedAbsPath), `${baseName}_post.mp4`);

    const hasSubs = !!(srtPath && fs.existsSync(srtPath));
    const hasWm = !!watermarkText;

    const vfParts = [];
    if (hasSubs) {
      const subEsc = escapeFfmpegPath(srtPath);
      vfParts.push(`subtitles='${subEsc}':charenc=UTF-8`);
    }
    if (hasWm) {
      const wmFile = path.join(tempRoot, 'watermark.txt');
      fs.writeFileSync(wmFile, watermarkText, 'utf8');
      const wmEsc = escapeFfmpegPath(wmFile);
      const fontOpt = getDrawtextFontOption();
      vfParts.push(
        `drawtext=textfile='${wmEsc}':reload=1${fontOpt}:x=w-tw-16:y=h-th-16:fontsize=22:fontcolor=white@0.82:borderw=2:bordercolor=black@0.55`
      );
    }
    let filterComplex = '';
    if (vfParts.length === 1) {
      filterComplex = `[0:v]${vfParts[0]}[vout]`;
    } else if (vfParts.length === 2) {
      filterComplex = `[0:v]${vfParts[0]}[vx];[vx]${vfParts[1]}[vout]`;
    }

    if (needAudio) {
      if (needSpeech && (!alignedAudioPath || !fs.existsSync(alignedAudioPath))) {
        return { ok: false, error: '内部错误：缺少对齐音轨' };
      }
      let bgmPath = null;
      if (episodeAudioPlan.bgm.mode === 'episode_track' && episodeAudioPlan.bgm.local_path) {
        const candidate = path.resolve(storageRoot, String(episodeAudioPlan.bgm.local_path).replace(/^[/\\]+/, ''));
        const relative = path.relative(path.resolve(storageRoot), candidate);
        if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate)) {
          try {
            const realRoot = fs.realpathSync(storageRoot);
            const realCandidate = fs.realpathSync(candidate);
            const realRelative = path.relative(realRoot, realCandidate);
            if (realRelative && !realRelative.startsWith('..') && !path.isAbsolute(realRelative)) bgmPath = realCandidate;
          } catch (_) {}
        }
      }
      const mixPlan = buildEpisodeAudioMixPlan({
        basePath: mergedAbsPath,
        baseHasAudio: ffprobeHasAudio(mergedAbsPath),
        dialoguePath: needSpeech ? alignedAudioPath : null,
        dialogueOwner: needSpeech ? 'post_tts' : 'none',
        narrationOwner: 'none',
        bgmMode: episodeAudioPlan.bgm.mode,
        bgmPath,
        bgmLevel: Math.pow(10, Number(episodeAudioPlan.bgm.volume_db || -22) / 20),
        bgmFadeInMs: episodeAudioPlan.bgm.fade_in_ms,
        bgmFadeOutMs: episodeAudioPlan.bgm.fade_out_ms,
        duckingDb: episodeAudioPlan.bgm.ducking_db,
        durationSeconds: videoDur,
        targetLufs: episodeAudioPlan.mastering.target_lufs,
        truePeak: episodeAudioPlan.mastering.true_peak_db,
      });
      const args = ['-y', '-i', mergedAbsPath];
      for (const audioInput of mixPlan.inputs) args.push('-i', audioInput);
      const combinedFilters = [filterComplex, mixPlan.filterComplex].filter(Boolean).join(';');
      if (filterComplex) {
        args.push('-filter_complex', combinedFilters, '-map', '[vout]', '-map', '[aout]');
      } else {
        args.push('-filter_complex', mixPlan.filterComplex, '-map', '0:v', '-map', '[aout]');
      }
      args.push(
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', outAbs
      );
      if (!runFfmpeg(args, log, 'mux_av')) {
        return { ok: false, error: '烧录字幕/水印或混音失败（请确认 ffmpeg 含 libx264）' };
      }
    } else {
      if (!filterComplex) {
        return { ok: false, error: '内部错误：仅水印但无滤镜链' };
      }
      const args = ['-y', '-i', mergedAbsPath, '-filter_complex', filterComplex, '-map', '[vout]'];
      if (ffprobeHasAudio(mergedAbsPath)) {
        args.push('-map', '0:a', '-c:a', 'copy');
      } else {
        args.push('-an');
      }
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-movflags', '+faststart', outAbs);
      if (!runFfmpeg(args, log, 'watermark_only')) {
        return { ok: false, error: '水印烧录失败' };
      }
    }

    if (!fs.existsSync(outAbs)) {
      return { ok: false, error: '输出文件未生成' };
    }

    const relFromRoot = path.relative(storageRoot, outAbs).replace(/\\/g, '/');

    try {
      if (!preserveInput && fs.existsSync(mergedAbsPath) && outAbs !== mergedAbsPath) {
        fs.unlinkSync(mergedAbsPath);
      }
    } catch (e) {
      log.warn('merged post: could not remove intermediate', { error: e.message });
    }

    log.info('merged post: done', { episode_id: episodeId, video: relFromRoot });
    return { ok: true, relativePath: relFromRoot };
  } catch (e) {
    log.warn('merged post: exception', { error: e.message });
    return { ok: false, error: e.message || String(e) };
  } finally {
    try {
      for (const p of fs.readdirSync(tempRoot)) {
        try {
          fs.unlinkSync(path.join(tempRoot, p));
        } catch (_) {}
      }
      fs.rmdirSync(tempRoot);
    } catch (_) {}
  }
}

function ffprobeHasAudio(filePath) {
  const probe = getFfprobePath();
  const r = spawnSync(
    probe,
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  return r.status === 0 && String(r.stdout || '').trim().length > 0;
}

module.exports = {
  runMergedEpisodePostProcess,
  ffprobeDurationSec,
  segmentStartTimesMs,
  buildSpeechTimelineFilter,
  resolveSpeechOwner,
  resolveStorageLocalFile,
};
