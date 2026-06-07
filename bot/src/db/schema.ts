// ============================================================
// DATABASE SCHEMA - Turso (libSQL)
// ============================================================

export const SCHEMA_SQL = `
-- Users: registered via /start
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  tg_id      INTEGER UNIQUE NOT NULL,
  username   TEXT,
  first_name TEXT NOT NULL,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Games: 30 games, each with N stages
CREATE TABLE IF NOT EXISTS games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  emoji       TEXT DEFAULT '🎮',
  total_stages INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stages: each stage belongs to a game
CREATE TABLE IF NOT EXISTS stages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id  INTEGER NOT NULL REFERENCES games(id),
  number   INTEGER NOT NULL,
  name     TEXT NOT NULL,
  UNIQUE(game_id, number)
);

-- Progress: admin stamps a stage for a user
CREATE TABLE IF NOT EXISTS progress (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(tg_id),
  game_id    INTEGER NOT NULL REFERENCES games(id),
  stage_id   INTEGER NOT NULL REFERENCES stages(id),
  stamped_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, stage_id)
);
`;
