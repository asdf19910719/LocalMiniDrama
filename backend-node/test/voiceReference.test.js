const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const id = () => crypto.randomUUID();

const { resolveVoiceReferenceAudios } = require('../src/director/voiceReference');
const { buildStructuredWorkflowPrompt } = require('../src/director/workflowRegistry');
const { createH3PromptCompiler } = require('../src/services/h3PromptCompiler');

describe('H3 voice reference (optional)', () => {
  let db;
  let storageRoot;
  beforeEach(() => {
    db = new Database(':memory:');
    const os = require('node:os');
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-ref-'));
    fs.mkdirSync(path.join(storageRoot, 'drama_3/characters/voice'), { recursive: true });
    fs.writeFileSync(path.join(storageRoot, 'drama_3/characters/voice/yunqing.wav'), 'wav-bytes');
    fs.writeFileSync(path.join(storageRoot, 'drama_3/characters/voice/stale.wav'), 'wav-bytes');
    db.exec(`
      CREATE TABLE storyboards (
        id TEXT PRIMARY KEY, characters TEXT
      );
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, deleted_at TEXT,
        seedance2_voice_asset TEXT
      );
    `);
  });
  afterEach(() => { fs.rmSync(storageRoot, { recursive: true, force: true }); db.close(); });

  it('resolves only active voice assets of the storyboard bound characters', () => {
    const insertChar = db.prepare(`INSERT INTO characters (id, drama_id, name, deleted_at, seedance2_voice_asset)
      VALUES (?, 3, ?, NULL, ?)`);
    insertChar.run(1, '云青', JSON.stringify({ status: 'active', local_path: 'drama_3/characters/voice/yunqing.wav' }));
    insertChar.run(2, '老郎中', JSON.stringify({ status: 'stale', local_path: 'drama_3/characters/voice/stale.wav' }));
    insertChar.run(3, '无音色', null);
    db.prepare("INSERT INTO storyboards (id, characters) VALUES ('501', '[1,2,3]')").run();

    const audios = resolveVoiceReferenceAudios(db, '501', storageRoot);
    assert.equal(audios.length, 1);
    assert.equal(audios[0].characterName, '云青');
    assert.ok(audios[0].audioFile.endsWith('yunqing.wav'));
  });

  it('fills timeline refAudios from reference audios without changing task type', () => {
    const workflow = require('../configs/workflows/minimax_h3_director_r2v.json');
    const output = buildStructuredWorkflowPrompt(workflow, {
      prompt: '测试提示词',
      durationSeconds: 5,
      referenceAudios: [{ audioFile: path.join(storageRoot, 'drama_3/characters/voice/yunqing.wav'), characterName: '云青' }],
    });
    const directorNode = Object.values(output).find((n) => n && n.class_type === 'MiniMaxH3Director');
    const timeline = JSON.parse(directorNode.inputs.timeline_data);
    assert.equal(timeline.global.refAudios.length, 1);
    assert.equal(timeline.global.refAudios[0].audioFile, path.join(storageRoot, 'drama_3/characters/voice/yunqing.wav'));
    assert.equal(timeline.segments[0].refAudios.length, 1);
    assert.equal(timeline.segments[0].refAudios[0].characterName, '云青');
  });

  it('tells the H3 compiler about the reference audio so the prompt directs speech', async () => {
    let captured = null;
    const compiler = createH3PromptCompiler({
      skillAgent: { run: async (db, log, args) => { captured = args; return { prompt: 'x', provenance: null }; } },
    });
    await compiler.compile({}, {}, {
      prompt: '测试提示词', durationSeconds: 5,
      referenceAudios: [{ characterName: '云青', audioFile: 'storage/voice/yunqing.wav' }],
    }).catch(() => {});
    assert.match(captured.sourceBundle, /REFERENCE_AUDIO: 云青/);
    assert.doesNotMatch((await import('../src/services/h3PromptCompiler.js')).sourceBundle({ prompt: 'x' }, 'T2VA'), /REFERENCE_AUDIO/);
  });
});
