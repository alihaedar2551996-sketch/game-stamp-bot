import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_TOKEN,
});

export async function initDB() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      tg_id      INTEGER UNIQUE NOT NULL,
      username   TEXT,
      first_name TEXT NOT NULL,
      joined_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS games (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      description  TEXT,
      emoji        TEXT DEFAULT '🎮',
      total_stages INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS stages (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id),
      number  INTEGER NOT NULL,
      name    TEXT NOT NULL,
      UNIQUE(game_id, number)
    )`,
    `CREATE TABLE IF NOT EXISTS progress (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(tg_id),
      game_id    INTEGER NOT NULL REFERENCES games(id),
      stage_id   INTEGER NOT NULL REFERENCES stages(id),
      stamped_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, stage_id)
    )`,
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }
  console.log("✅ DB initialized");
}

// ── Users ──────────────────────────────────────────────────
export async function upsertUser(tgId: number, username: string | undefined, firstName: string) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (tg_id, username, first_name) VALUES (?, ?, ?)`,
    args: [tgId, username ?? null, firstName],
  });
}

export async function getAllUsers() {
  const res = await db.execute(`SELECT * FROM users ORDER BY joined_at DESC`);
  return res.rows;
}

// ── Games ──────────────────────────────────────────────────
export async function getAllGames() {
  const res = await db.execute(`SELECT * FROM games ORDER BY id`);
  return res.rows;
}

export async function getGame(gameId: number) {
  const res = await db.execute({ sql: `SELECT * FROM games WHERE id = ?`, args: [gameId] });
  return res.rows[0];
}

// ── Stages ─────────────────────────────────────────────────
export async function getStagesByGame(gameId: number) {
  const res = await db.execute({
    sql: `SELECT * FROM stages WHERE game_id = ? ORDER BY number`,
    args: [gameId],
  });
  return res.rows;
}

// ── Progress ───────────────────────────────────────────────
export async function getUserProgress(tgId: number) {
  const res = await db.execute({
    sql: `
      SELECT g.id as game_id, g.name as game_name, g.emoji, g.total_stages,
             COUNT(p.id) as completed_stages
      FROM games g
      LEFT JOIN progress p ON p.game_id = g.id AND p.user_id = ?
      GROUP BY g.id
      ORDER BY g.id
    `,
    args: [tgId],
  });
  return res.rows;
}

export async function getCompletedStages(tgId: number, gameId: number) {
  const res = await db.execute({
    sql: `SELECT stage_id FROM progress WHERE user_id = ? AND game_id = ?`,
    args: [tgId, gameId],
  });
  return res.rows.map(r => Number(r.stage_id));
}

// FIX #3: تحقق من rowsAffected بدل ما ترجع true دايماً
export async function stampStage(tgId: number, gameId: number, stageId: number) {
  try {
    const result = await db.execute({
      sql: `INSERT OR IGNORE INTO progress (user_id, game_id, stage_id) VALUES (?, ?, ?)`,
      args: [tgId, gameId, stageId],
    });
    // rowsAffected === 0 يعني كانت مختومة مسبقاً
    return Number(result.rowsAffected) > 0;
  } catch {
    return false;
  }
}

// FIX #4: COUNT(DISTINCT stage_id) بدل COUNT(*) لضمان دقة الحساب
export async function isGameComplete(tgId: number, gameId: number, totalStages: number) {
  const res = await db.execute({
    sql: `SELECT COUNT(DISTINCT stage_id) as cnt FROM progress WHERE user_id = ? AND game_id = ?`,
    args: [tgId, gameId],
  });
  return Number(res.rows[0].cnt) >= totalStages;
}

// ── Dashboard Stats ────────────────────────────────────────
export async function getDashboardStats() {
  const [users, stamps, games] = await Promise.all([
    db.execute(`SELECT COUNT(*) as cnt FROM users`),
    db.execute(`SELECT COUNT(*) as cnt FROM progress`),
    db.execute(`SELECT COUNT(*) as cnt FROM games`),
  ]);
  return {
    totalUsers: Number(users.rows[0].cnt),
    totalStamps: Number(stamps.rows[0].cnt),
    totalGames: Number(games.rows[0].cnt),
  };
}

export async function getRecentStamps(limit = 20) {
  const res = await db.execute({
    sql: `
      SELECT p.stamped_at, u.first_name, u.username, u.tg_id,
             g.name as game_name, g.emoji, s.name as stage_name, s.number as stage_number
      FROM progress p
      JOIN users u ON u.tg_id = p.user_id
      JOIN games g ON g.id = p.game_id
      JOIN stages s ON s.id = p.stage_id
      ORDER BY p.stamped_at DESC
      LIMIT ?
    `,
    args: [limit],
  });
  return res.rows;
}

export async function getAllUsersWithProgress() {
  const res = await db.execute(`
    SELECT u.tg_id, u.first_name, u.username, u.joined_at,
           COUNT(p.id) as total_stamps
    FROM users u
    LEFT JOIN progress p ON p.user_id = u.tg_id
    GROUP BY u.tg_id
    ORDER BY total_stamps DESC
  `);
  return res.rows;
}
