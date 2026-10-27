const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT NOT NULL,
      party_size INTEGER,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',  -- waiting | notified | seated | removed
      created_at TEXT NOT NULL,
      notified_at TEXT,
      seated_at TEXT,
      removed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id INTEGER,
      kind TEXT NOT NULL,          -- join | ready
      to_phone TEXT NOT NULL,
      body TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,        -- sent | demo | failed
      provider_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

module.exports = { openDb };
