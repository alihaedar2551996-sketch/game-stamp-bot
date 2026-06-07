import { Bot, webhookCallback } from "grammy";
import { Hono } from "hono";
import { initDB } from "./db/client";
import { seedGames } from "./db/seed";
import { registerUserHandlers } from "./handlers/user";
import { readFileSync } from "fs";
import { join } from "path";

const BOT_TOKEN = process.env.BOT_TOKEN!;
const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "mysecret123";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const API_KEY = process.env.ADMIN_API_KEY ?? "1996";

export const bot = new Bot(BOT_TOKEN);
registerUserHandlers(bot);
bot.catch((err) => console.error("Bot error:", err.message));

const app = new Hono();

// CORS — allow everything
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
});
app.options("*", (c) => c.text("", 204));

// Auth: check Authorization header OR x-api-key header OR ?key= query param
function auth(c: any): boolean {
  const fromHeader = c.req.header("Authorization")?.replace("Bearer ", "");
  const fromXHeader = c.req.header("x-api-key");
  const fromQuery = c.req.query("key");
  return fromHeader === API_KEY || fromXHeader === API_KEY || fromQuery === API_KEY;
}

// ── Static files ───────────────────────────────────────────
const STATIC_DIR = join(import.meta.dir, ".");

app.get("/styles.css", (c) => {
  const css = readFileSync(join(STATIC_DIR, "styles.css"), "utf-8");
  return c.text(css, 200, { "Content-Type": "text/css" });
});
app.get("/theme.js", (c) => {
  const js = readFileSync(join(STATIC_DIR, "theme.js"), "utf-8");
  return c.text(js, 200, { "Content-Type": "application/javascript" });
});
app.get("/dashboard", (c) => {
  const html = readFileSync(join(STATIC_DIR, "dashboard.html"), "utf-8");
  return c.html(html);
});

// Health
app.get("/", (c) => c.json({ status: "ok" }));
app.get("/health", (c) => c.json({ status: "ok" }));

// Webhook
if (WEBHOOK_URL) {
  app.post(`/webhook/${WEBHOOK_SECRET}`, webhookCallback(bot, "hono"));
}

import {
  getDashboardStats, getRecentStamps, getAllUsersWithProgress,
  getAllGames, getStagesByGame, stampStage, isGameComplete, getUserProgress,
} from "./db/client";
import { notifyStageComplete } from "./utils/notify";

app.get("/api/stats",          async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getDashboardStats()); });
app.get("/api/users",          async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getAllUsersWithProgress()); });
app.get("/api/stamps",         async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getRecentStamps(50)); });
app.get("/api/games",          async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getAllGames()); });
app.get("/api/games/:id/stages", async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getStagesByGame(Number(c.req.param("id")))); });
app.get("/api/users/:tgId/progress", async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getUserProgress(Number(c.req.param("tgId")))); });

app.post("/api/stamp", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  const { tgId, gameId, stageId } = await c.req.json();
  if (!tgId || !gameId || !stageId) return c.json({ error: "Missing fields" }, 400);
  const ok = await stampStage(tgId, gameId, stageId);
  if (!ok) return c.json({ error: "Already stamped or DB error" }, 409);
  const [games, stages] = await Promise.all([getAllGames(), getStagesByGame(gameId)]);
  const game = games.find(g => Number(g.id) === gameId);
  const stage = stages.find(s => Number(s.id) === stageId);
  if (game && stage) {
    const complete = await isGameComplete(tgId, gameId, Number(game.total_stages));
    try { await notifyStageComplete(bot, tgId, String(game.emoji), String(game.name), Number(stage.number), String(stage.name), Number(game.total_stages)); }
    catch (e) { console.error("Notify error:", e); }
    return c.json({ success: true, gameComplete: complete });
  }
  return c.json({ success: true });
});

async function main() {
  await initDB();
  await seedGames();
  if (WEBHOOK_URL) {
    await bot.api.setWebhook(`${WEBHOOK_URL}/webhook/${WEBHOOK_SECRET}`);
    console.log(`✅ Webhook set`);
  } else {
    bot.start({ onStart: () => console.log("🤖 Bot polling started") });
  }
  Bun.serve({ port: PORT, fetch: app.fetch });
  console.log(`🚀 Server on port ${PORT}`);
}

main().catch(console.error);
