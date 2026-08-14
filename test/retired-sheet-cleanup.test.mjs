import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';

test('retired Sheet cleanup removes only Sheet-owned posts and disables legacy cross-post flags', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE fanpages (id TEXT PRIMARY KEY, crossPostInstagram INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE posts (
      id TEXT PRIMARY KEY, source TEXT, sheetUrl TEXT, sheetRowKey TEXT, sheetDefaultFanpageId TEXT
    );
    CREATE TABLE publish_jobs (
      postId TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE TABLE publish_attempts (
      id TEXT PRIMARY KEY, postId TEXT REFERENCES posts(id) ON DELETE CASCADE
    );
    INSERT INTO fanpages VALUES ('fp-1', 1), ('fp-2', 0);
    INSERT INTO posts VALUES
      ('sheet-1', 'scheduled-sheet', NULL, NULL, NULL),
      ('sheet-2', 'scheduled', 'https://sheet.test', 'row-1', 'fp-1'),
      ('manual-1', 'scheduled', NULL, NULL, NULL);
    INSERT INTO publish_jobs VALUES ('sheet-1'), ('manual-1');
    INSERT INTO publish_attempts VALUES ('attempt-sheet', 'sheet-1'), ('attempt-manual', 'manual-1');
  `);

  try {
    db.exec(fs.readFileSync(new URL('../scripts/retire-sheet-crosspost.sql', import.meta.url), 'utf8'));
    assert.deepEqual(db.prepare('SELECT id FROM posts ORDER BY id').all().map(row => row.id), ['manual-1']);
    assert.deepEqual(db.prepare('SELECT postId FROM publish_jobs').all().map(row => row.postId), ['manual-1']);
    assert.deepEqual(db.prepare('SELECT postId FROM publish_attempts').all().map(row => row.postId), ['manual-1']);
    assert.equal(db.prepare('SELECT SUM(crossPostInstagram) AS enabled FROM fanpages').get().enabled, 0);
  } finally {
    db.close();
  }
});
