const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const dramaService = require('../src/services/dramaService');
const dramaExportService = require('../src/services/dramaExportService');
const tailFrameLinkService = require('../src/services/tailFrameLinkService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      video_url TEXT,
      local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      status TEXT,
      video_url TEXT,
      local_path TEXT,
      completed_at TEXT,
      updated_at TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

describe('video lifecycle compatibility consumers', () => {
  it('uses review and selected videos when finalizing an episode', () => {
    for (const status of ['review', 'selected', 'completed']) {
      const db = createDb();
      db.prepare('INSERT INTO storyboards (id, updated_at) VALUES (1, ?)').run('2026-01-01T00:00:00.000Z');
      db.prepare(`
        INSERT INTO video_generations
          (id, storyboard_id, status, local_path, completed_at, updated_at, created_at)
        VALUES (1, 1, ?, 'projects/demo/videos/final.mp4', ?, ?, ?)
      `).run(status, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');

      assert.equal(
        dramaService.getVideoUrlForStoryboard(db, 1, 'http://127.0.0.1:3000/static'),
        'http://127.0.0.1:3000/static/projects/demo/videos/final.mp4',
        status,
      );
      db.close();
    }
  });

  it('exports the latest review, selected, or legacy completed video', () => {
    const db = createDb();
    const insert = db.prepare(`
      INSERT INTO video_generations
        (id, storyboard_id, status, local_path, created_at)
      VALUES (?, 7, ?, ?, ?)
    `);
    insert.run(1, 'failed', 'videos/failed.mp4', '2026-01-04T00:00:00.000Z');
    insert.run(2, 'review', 'videos/review.mp4', '2026-01-02T00:00:00.000Z');
    insert.run(3, 'selected', 'videos/selected.mp4', '2026-01-03T00:00:00.000Z');

    assert.deepEqual(
      dramaExportService.getLatestPlayableVideo(db, 7),
      { video_url: null, local_path: 'videos/selected.mp4' },
    );
    db.close();
  });

  it('allows tail-frame continuity to use a canonical review video', () => {
    const db = createDb();
    db.prepare(`
      INSERT INTO video_generations
        (id, storyboard_id, status, local_path, created_at)
      VALUES (11, 8, 'review', 'videos/review-tail.mp4', '2026-01-02T00:00:00.000Z')
    `).run();

    assert.deepEqual(
      tailFrameLinkService.getLatestPlayableVideo(db, 8),
      { id: 11, local_path: 'videos/review-tail.mp4', video_url: null },
    );
    db.close();
  });
});
