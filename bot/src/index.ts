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
const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID ?? "6762566920");

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required");
if (!API_KEY) throw new Error("ADMIN_API_KEY is required");
if (WEBHOOK_URL && !WEBHOOK_SECRET) throw new Error("WEBHOOK_SECRET is required when WEBHOOK_URL is set");

export const bot = new Bot(BOT_TOKEN);
registerUserHandlers(bot);
// bot.catch moved to logger section below

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
  const fromCookie = getCookie(c.req.raw.headers.get("cookie") ?? "", "admin_session");
  return fromHeader === API_KEY || fromXHeader === API_KEY || fromCookie === API_KEY;
}

function getCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
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
  getRevenueStats,
  getOrderLevels, stampLevel, getOrder, addBalance, getUserBalance,
  getAllTopupRequests, approveTopup, rejectTopup, initTopupTable,
  getReferrer, addReferralCommission, getReferralStats,
} from "./db/client";

// ── Admin Notify ────────────────────────────────────────────────────────────
async function notifyAdmin(msg: string) {
  try {
    await bot.api.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: "HTML" });
  } catch(e) {
    log("WARN", "NOTIFY", "Failed to notify admin", e);
  }
}

// ── Login / Logout ──────────────────────────────────────────────────────────
app.post("/api/login", async (c) => {
  const { key } = await c.req.json();
  if (!key || key !== API_KEY) return c.json({ error: "Unauthorized" }, 401);
  const secure = (process.env.WEBHOOK_URL ?? "").startsWith("https") ? "; Secure" : "";
  c.res = new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `admin_session=${encodeURIComponent(API_KEY)}; HttpOnly; SameSite=Strict; Path=/${secure}; Max-Age=86400`,
    },
  });
  return c.res;
});

app.post("/api/logout", (c) => {
  c.res = new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    },
  });
  return c.res;
});

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
  const topupId = Number(c.req.param("id"));
  const result = await approveTopup(topupId, Number(amount));

  // إشعار الأدمن بالقبول
  await notifyAdmin(
    `✅ <b>تم قبول شحن #${topupId}</b>\n` +
    `💰 المبلغ: <b>${Number(amount).toFixed(2)}$</b>\n` +
    `👤 User ID: <code>${result.userId}</code>`
  );

  // إشعار المستخدم بقبول الشحن
  try {
    await bot.api.sendMessage(result.userId,
      `✅ <b>تم قبول طلب الشحن!</b>\n\n💰 تم إضافة <b>${Number(amount).toFixed(2)} دولار</b> لرصيدك\n💵 رصيدك الحالي: <b>${result.newBalance.toFixed(2)} دولار</b>`,
      { parse_mode: "HTML" }
    );
  } catch(e) { console.error(e); }

  // عمولة 10% للمدعي إن وجد
  const referrerId = await getReferrer(result.userId);
  if (referrerId) {
    const commission = parseFloat((Number(amount) * 0.10).toFixed(2));
    if (commission > 0) {
      const newReferrerBalance = await addReferralCommission(referrerId, result.userId, topupId, commission);
      try {
        await bot.api.sendMessage(referrerId,
          `🎁 <b>ربحت عمولة إحالة!</b>\n\n💰 <b>${commission.toFixed(2)}$</b> (10% من شحن صديقك)\n💵 رصيدك الحالي: <b>${newReferrerBalance.toFixed(2)}$</b>`,
          { parse_mode: "HTML" }
        );
      } catch(e) { console.error("referral notify error:", e); }
    }
  }

  return c.json({ success: true, newBalance: result.newBalance });
});

app.post("/api/topups/:id/reject", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  const topupRejectId = Number(c.req.param("id"));
  const userId = await rejectTopup(topupRejectId);
  await notifyAdmin(`❌ <b>تم رفض شحن #${topupRejectId}</b>\n👤 User ID: <code>${userId}</code>`);
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
        await notifyAdmin(
          `🎉 <b>طلب مكتمل #${orderId}</b>\n` +
          `${order.emoji} <b>${order.game_name}</b>\n` +
          `👤 ${order.first_name}${order.username ? ` (@${order.username})` : ""}\n` +
          `✅ جميع الليفلات اكتملت`
        );
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

// إحصائيات الإحالات
app.get("/api/referrals", async (c) => {

app.get("/api/revenue", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await getRevenueStats());
});
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await getReferralStats());
});

// بث رسالة جماعية
app.post("/api/broadcast", async (c) => {
  if (!auth(c)) return c.json({ error: "Unauthorized" }, 401);
  const { message } = await c.req.json();
  if (!message || !message.trim()) return c.json({ error: "message required" }, 400);

  const users = await getAllUsersWithBalance();
  let sent = 0, failed = 0;

  for (const user of users) {
    try {
      await bot.api.sendMessage(Number(user.tg_id), message, { parse_mode: "HTML" });
      sent++;
    } catch (e) {
      failed++;
    }
    // تأخير بسيط لتجنب rate limit تيليغرام (30 رسالة/ثانية)
    await new Promise(r => setTimeout(r, 40));
  }

  return c.json({ success: true, sent, failed, total: users.length });
});

let ready = false;

// ── Logger ─────────────────────────────────────────────────────────────────
function log(level: "INFO" | "WARN" | "ERROR", scope: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] [${scope}] ${msg}`;
  if (data !== undefined) {
    const extra = data instanceof Error ? data.stack ?? data.message : JSON.stringify(data);
    level === "ERROR" ? console.error(line, extra) : console.log(line, extra);
  } else {
    level === "ERROR" ? console.error(line) : console.log(line);
  }
}

// ── Healthcheck ─────────────────────────────────────────────────────────────
app.get("/health", (c) => {
  log("INFO", "HEALTH", `ping — ready=${ready}`);
  return c.json({ status: "ok", ready });
});

// ── Request Logger Middleware ────────────────────────────────────────────────
app.use("/api/*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log("INFO", "HTTP", `${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
});

// ── Webhook Logger ───────────────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const type = ctx.updateType ?? "unknown";
  const userId = ctx.from?.id;
  const username = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "?";
  log("INFO", "BOT", `update=${type} user=${userId} (${username})`);
  try {
    await next();
  } catch (e) {
    log("ERROR", "BOT", `handler error for update=${type} user=${userId}`, e);
    throw e;
  }
});

bot.catch((err) => {
  log("ERROR", "BOT", "Unhandled bot error", err.error ?? err.message);
});

async function main() {
  log("INFO", "STARTUP", `Starting AutoGamer Bot...`);
  log("INFO", "STARTUP", `PORT=${PORT} | WEBHOOK_URL=${WEBHOOK_URL ?? "(polling mode)"}`);

  Bun.serve({ port: PORT, fetch: app.fetch });
  log("INFO", "STARTUP", `✅ HTTP server listening on port ${PORT}`);

  (async () => {
    try {
      // retry للـ DB لو الاتصال بطيء
      let dbAttempts = 0;
      while (dbAttempts < 5) {
        try {
          log("INFO", "INIT", `Initializing database (attempt ${dbAttempts + 1}/5)...`);
          await initDB();
          await initTopupTable();
          await seedGames();
          log("INFO", "INIT", "✅ DB ready");
          break;
        } catch (e) {
          dbAttempts++;
          log("WARN", "INIT", `DB init attempt ${dbAttempts}/5 failed — retrying in 3s...`, e);
          if (dbAttempts >= 5) throw e;
          await new Promise(r => setTimeout(r, 3000));
        }
      }

      if (WEBHOOK_URL) {
        const webhookEndpoint = `${WEBHOOK_URL}/webhook/${WEBHOOK_SECRET}`;

        // retry حتى 5 مرات لو فشل الـ webhook
        let attempts = 0;
        while (attempts < 5) {
          try {
            await bot.api.setWebhook(webhookEndpoint);
            const info = await bot.api.getWebhookInfo();
            log("INFO", "WEBHOOK", `✅ Webhook set → ${webhookEndpoint}`);
            log("INFO", "WEBHOOK", `pending_updates=${info.pending_update_count} | last_error=${info.last_error_message ?? "none"}`);
            break;
          } catch (e) {
            attempts++;
            log("WARN", "WEBHOOK", `attempt ${attempts}/5 failed — retrying in 3s...`, e);
            if (attempts >= 5) throw e;
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      } else {
        log("INFO", "POLLING", "No WEBHOOK_URL — starting long polling...");
        bot.start({ onStart: () => log("INFO", "POLLING", "✅ Bot polling started") });
      }

      ready = true;
      log("INFO", "STARTUP", "✅ Bot fully ready");
    } catch (e) {
      log("ERROR", "INIT", "❌ Init failed — bot will NOT respond to messages", e);
    }
  })();
}

main().catch((e) => log("ERROR", "MAIN", "Fatal error in main()", e));
