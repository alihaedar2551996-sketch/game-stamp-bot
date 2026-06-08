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
      balance    REAL NOT NULL DEFAULT 0,
      joined_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS games (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      emoji       TEXT DEFAULT '🎮',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(tg_id),
      game_id      INTEGER NOT NULL REFERENCES games(id),
      idfa         TEXT,
      idfv         TEXT,
      ios_version  TEXT,
      appsflyer_id TEXT,
      levels       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS order_levels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES orders(id),
      level      INTEGER NOT NULL,
      stamped    INTEGER NOT NULL DEFAULT 0,
      stamped_at TEXT,
      UNIQUE(order_id, level)
    )`,
    `CREATE TABLE IF NOT EXISTS balance_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(tg_id),
      amount     REAL NOT NULL,
      note       TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  // migration: إضافة عمود balance إذا ما كان موجود (للقواعد القديمة)
  await db.execute(`ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 0`).catch(() => {});

  console.log("✅ DB initialized");
}

// ── Users ──────────────────────────────────────────────────
export async function upsertUser(tgId: number, username: string | undefined, firstName: string) {
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (tg_id, username, first_name) VALUES (?, ?, ?)`,
    args: [tgId, username ?? null, firstName],
  });
}

export async function getUserBalance(tgId: number): Promise<number> {
  const res = await db.execute({ sql: `SELECT balance FROM users WHERE tg_id = ?`, args: [tgId] });
  return res.rows[0] ? Number(res.rows[0].balance) : 0;
}

export async function addBalance(tgId: number, amount: number, note?: string): Promise<number> {
  await db.execute({ sql: `UPDATE users SET balance = balance + ? WHERE tg_id = ?`, args: [amount, tgId] });
  await db.execute({ sql: `INSERT INTO balance_log (user_id, amount, note) VALUES (?, ?, ?)`, args: [tgId, amount, note ?? null] });
  const res = await db.execute({ sql: `SELECT balance FROM users WHERE tg_id = ?`, args: [tgId] });
  return Number(res.rows[0].balance);
}

export async function getAllUsersWithBalance() {
  const res = await db.execute(`
    SELECT u.tg_id, u.first_name, u.username, u.joined_at, u.balance,
           COUNT(o.id) as total_orders
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.tg_id
    GROUP BY u.tg_id
    ORDER BY u.joined_at DESC
  `);
  return res.rows;
}

// ── Games ──────────────────────────────────────────────────
export async function getAllGames() {
  const res = await db.execute(`SELECT * FROM games ORDER BY id`);
  return res.rows;
}

// ── Orders ─────────────────────────────────────────────────
export async function createOrder(
  userId: number, gameId: number,
  idfa: string, idfv: string, iosVersion: string, appsflyerId: string,
  levels: number[]
): Promise<number> {
  const res = await db.execute({
    sql: `INSERT INTO orders (user_id, game_id, idfa, idfv, ios_version, appsflyer_id, levels)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [userId, gameId, idfa, idfv, iosVersion, appsflyerId, levels.join(",")],
  });
  const orderId = Number(res.lastInsertRowid);
  for (const level of levels) {
    await db.execute({
      sql: `INSERT INTO order_levels (order_id, level) VALUES (?, ?)`,
      args: [orderId, level],
    });
  }
  return orderId;
}

export async function getOrdersByUser(tgId: number) {
  const res = await db.execute({
    sql: `SELECT o.*, g.name as game_name, g.emoji
          FROM orders o JOIN games g ON g.id = o.game_id
          WHERE o.user_id = ? ORDER BY o.created_at DESC`,
    args: [tgId],
  });
  return res.rows;
}

export async function getAllOrders() {
  const res = await db.execute(`
    SELECT o.*, g.name as game_name, g.emoji,
           u.first_name, u.username, u.tg_id as user_tg_id
    FROM orders o
    JOIN games g ON g.id = o.game_id
    JOIN users u ON u.tg_id = o.user_id
    ORDER BY o.created_at DESC
  `);
  return res.rows;
}

export async function getOrderLevels(orderId: number) {
  const res = await db.execute({
    sql: `SELECT * FROM order_levels WHERE order_id = ? ORDER BY level`,
    args: [orderId],
  });
  return res.rows;
}

export async function stampLevel(orderId: number, level: number): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE order_levels SET stamped = 1, stamped_at = datetime('now')
          WHERE order_id = ? AND level = ? AND stamped = 0`,
    args: [orderId, level],
  });
  if (Number(result.rowsAffected) === 0) return false;
  // تحقق إذا كل الليفلات مكتملة
  const pending = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM order_levels WHERE order_id = ? AND stamped = 0`,
    args: [orderId],
  });
  if (Number(pending.rows[0].cnt) === 0) {
    await db.execute({ sql: `UPDATE orders SET status = 'completed' WHERE id = ?`, args: [orderId] });
  }
  return true;
}

export async function getOrder(orderId: number) {
  const res = await db.execute({
    sql: `SELECT o.*, g.name as game_name, g.emoji,
                 u.first_name, u.username, u.tg_id as user_tg_id
          FROM orders o
          JOIN games g ON g.id = o.game_id
          JOIN users u ON u.tg_id = o.user_id
          WHERE o.id = ?`,
    args: [orderId],
  });
  return res.rows[0];
}

// ── Dashboard Stats ────────────────────────────────────────
export async function getDashboardStats() {
  const [users, orders, games] = await Promise.all([
    db.execute(`SELECT COUNT(*) as cnt FROM users`),
    db.execute(`SELECT COUNT(*) as cnt FROM orders`),
    db.execute(`SELECT COUNT(*) as cnt FROM games`),
  ]);
  return {
    totalUsers: Number(users.rows[0].cnt),
    totalOrders: Number(orders.rows[0].cnt),
    totalGames: Number(games.rows[0].cnt),
  };
}

// ── Topup Requests ─────────────────────────────────────────
export async function initTopupTable() {
  await db.execute(`CREATE TABLE IF NOT EXISTS topup_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(tg_id),
    method      TEXT NOT NULL,
    amount      TEXT,
    tx_id       TEXT,
    photo_id    TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

export async function createTopupRequest(
  userId: number, method: string, amount: string, txId: string | null, photoId: string | null
): Promise<number> {
  const res = await db.execute({
    sql: `INSERT INTO topup_requests (user_id, method, amount, tx_id, photo_id) VALUES (?, ?, ?, ?, ?)`,
    args: [userId, method, amount, txId, photoId],
  });
  return Number(res.lastInsertRowid);
}

export async function getAllTopupRequests() {
  const res = await db.execute(`
    SELECT t.*, u.first_name, u.username, u.tg_id as user_tg_id
    FROM topup_requests t
    JOIN users u ON u.tg_id = t.user_id
    ORDER BY t.created_at DESC
  `);
  return res.rows;
}

export async function approveTopup(id: number, amount: number): Promise<{ userId: number; newBalance: number }> {
  const req = await db.execute({ sql: `SELECT * FROM topup_requests WHERE id = ?`, args: [id] });
  const r = req.rows[0];
  if (!r) throw new Error("Not found");
  await db.execute({ sql: `UPDATE topup_requests SET status = 'approved' WHERE id = ?`, args: [id] });
  const newBalance = await addBalance(Number(r.user_id), amount, `شحن رصيد #${id}`);
  return { userId: Number(r.user_id), newBalance };
}

export async function rejectTopup(id: number): Promise<number> {
  const req = await db.execute({ sql: `SELECT * FROM topup_requests WHERE id = ?`, args: [id] });
  const r = req.rows[0];
  if (!r) throw new Error("Not found");
  await db.execute({ sql: `UPDATE topup_requests SET status = 'rejected' WHERE id = ?`, args: [id] });
  return Number(r.user_id);
}
