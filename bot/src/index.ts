import { Bot, webhookCallback } from "grammy";
import { Hono } from "hono";
import { initDB } from "./db/client";
import { seedGames } from "./db/seed";
import { registerUserHandlers } from "./handlers/user";
import { readFileSync } from "fs";
import { join } from "path";

const BOT_TOKEN = process.env.BOT_TOKEN!;
const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const API_KEY = process.env.ADMIN_API_KEY!;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!API_KEY) throw new Error("ADMIN_API_KEY is required");
if (WEBHOOK_URL && !WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET is required when WEBHOOK_URL is set");

export const bot = new Bot(BOT_TOKEN);
registerUserHandlers(bot);
bot.catch((err) => console.error("Bot error:", err.message, err.error));

const app = new Hono();
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
});
app.options("*", (c) => c.text("", 204));

function auth(c: any): boolean {
  const fromHeader = c.req.header("Authorization")?.replace("Bearer ", "");
  const fromXHeader = c.req.header("x-api-key");
  const fromQuery = c.req.query("key");
  return fromHeader === API_KEY || fromXHeader === API_KEY || fromQuery === API_KEY;
}

const STATIC_DIR = join(import.meta.dir, ".");
app.get("/styles.css", (c) => c.text(readFileSync(join(STATIC_DIR, "styles.css"), "utf-8"), 200, { "Content-Type": "text/css" }));
app.get("/theme.js",   (c) => c.text(readFileSync(join(STATIC_DIR, "theme.js"),   "utf-8"), 200, { "Content-Type": "application/javascript" }));
app.get("/dashboard",  (c) => c.html(readFileSync(join(STATIC_DIR, "dashboard.html"), "utf-8")));
app.get("/",           (c) => c.json({ status: "ok" }));

if (WEBHOOK_URL) {
  app.post(`/webhook/${WEBHOOK_SECRET}`, webhookCallback(bot, "hono"));
}

import {
  getDashboardStats, getAllUsersWithBalance, getAllOrders,
  getOrderLevels, stampLevel, getOrder, addBalance, getUserBalance,
  getAllTopupRequests, approveTopup, rejectTopup, initTopupTable,
} from "./db/client";

app.get("/api/stats",  async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getDashboardStats()); });
app.get("/api/users",  async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getAllUsersWithBalance()); });
app.get("/api/orders", async (c) => { if (!auth(c)) return c.json({ error: "Unauthorized" }, 401); return c.json(await getAllOrders()); });
app.get("/api/orders/:id/levels", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await getOrderLevels(Number(c.req.param("id"))));
});
app.get("/api/users/:tgId/balance", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ balance: await getUserBalance(Number(c.req.param("tgId"))) });
});

// طلبات الشحن
app.get("/api/topups", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await getAllTopupRequests());
});

app.post("/api/topups/:id/approve", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  const { amount } = await c.req.json();
  if (!amount) return c.json({ error: "amount required" }, 400);
  const result = await approveTopup(Number(c.req.param("id")), Number(amount));
  try {
    await bot.api.sendMessage(result.userId,
      `✅ <b>تم قبول طلب الشحن!</b>\n\n💰 تم إضافة <b>${Number(amount).toFixed(2)} دولار</b> لرصيدك\n💵 رصيدك الحالي: <b>${result.newBalance.toFixed(2)} دولار</b>`,
      { parse_mode: "HTML" }
    );
  } catch(e) { console.error(e); }
  return c.json({ success: true, newBalance: result.newBalance });
});

app.post("/api/topups/:id/reject", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  const userId = await rejectTopup(Number(c.req.param("id")));
  try {
    await bot.api.sendMessage(userId,
      `❌ <b>تم رفض طلب الشحن</b>\n\nتواصل مع الدعم لمزيد من المعلومات.`,
      { parse_mode: "HTML" }
    );
  } catch(e) { console.error(e); }
  return c.json({ success: true });
});

// ختم ليفل
app.post("/api/stamp-level", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  const { orderId, level } = await c.req.json();
  if (!orderId || !level) return c.json({ error: "Missing fields" }, 400);
  const ok = await stampLevel(orderId, level);
  if (!ok) return c.json({ error: "Already stamped or not found" }, 409);
  const order = await getOrder(orderId);
  if (order) {
    try {
      const allLevels = String(order.levels).split(",").map(Number);
      if (order.status === "completed") {
        await bot.api.sendMessage(Number(order.user_tg_id),
          `🎉 <b>مبروك! اكتمل طلبك بالكامل!</b>\n\n${order.emoji} <b>${order.game_name}</b>\n✅ تم ختم جميع الليفلات: ${allLevels.join(", ")}\n\nأنت بطل حقيقي! 🏆`,
          { parse_mode: "HTML" }
        );
      } else {
        await bot.api.sendMessage(Number(order.user_tg_id),
          `✅ <b>تم ختم ليفل جديد!</b>\n\n${order.emoji} <b>${order.game_name}</b>\n🎯 الليفل <b>${level}</b> تم ختمه بنجاح!\n\nاستمر! 💪`,
          { parse_mode: "HTML" }
        );
      }
    } catch(e) { console.error("Notify error:", e); }
  }
  return c.json({ success: true, orderComplete: order?.status === "completed" });
});

// إضافة رصيد يدوي
app.post("/api/balance", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  const { tgId, amount, note } = await c.req.json();
  if (!tgId || amount === undefined) return c.json({ error: "Missing fields" }, 400);
  const newBalance = await addBalance(tgId, amount, note);
  try {
    const sign = amount >= 0 ? "+" : "";
    await bot.api.sendMessage(tgId,
      `💵 <b>تم تحديث رصيدك!</b>\n\n${sign}${amount.toFixed(2)} دولار\n💰 رصيدك الحالي: <b>${newBalance.toFixed(2)} دولار</b>` + (note ? `\n📝 ${note}` : ""),
      { parse_mode: "HTML" }
    );
  } catch(e) { console.error(e); }
  return c.json({ success: true, newBalance });
});

// صورة الإثبات
app.get("/api/photo/:fileId", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  try {
    const file = await bot.api.getFile(c.req.param("fileId"));
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    return c.redirect(url);
  } catch(e) { return c.json({ error: "File not found" }, 404); }
});

let ready = false;

// healthcheck يرد فوراً حتى لو الـ init لسا ما خلص
app.get("/health", (c) => c.json({ status: "ok", ready }));

async function main() {
  // ابدأ السيرفر أول شي — Railway يشوفه فوراً
  Bun.serve({ port: PORT, fetch: app.fetch });
  console.log(`🚀 Server on port ${PORT}`);

  // الـ init في الخلفية — ما يبلوك الـ healthcheck
  (async () => {
    try {
      await initDB();
      await initTopupTable();
      await seedGames();
      if (WEBHOOK_URL) {
        await bot.api.setWebhook(`${WEBHOOK_URL}/webhook/${WEBHOOK_SECRET}`);
        console.log(`✅ Webhook set`);
      } else {
        bot.start({ onStart: () => console.log("🤖 Bot polling started") });
      }
      ready = true;
      console.log("✅ Bot ready");
    } catch (e) {
      console.error("❌ Init failed:", e);
    }
  })();
}

main().catch(console.error);
