import { Bot, InlineKeyboard } from "grammy";
import { upsertUser, getAllGames, getUserBalance, deductBalance, createOrder, getOrdersByUser, getOrderLevels, createTopupRequest } from "../db/client";

const SUPPORT_USERNAME = "AutoGamers";
const SYRIATEL_NUMBER = "35181383";
const USDT_ADDRESS = "0x77cf846eccb684f524b6a8d357e4dee6ded83a78";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 دقيقة
const ORDER_PRICE = 2; // سعر الطلب بالدولار

interface Session {
  step: string;
  gameId?: number;
  gameName?: string;
  gameEmoji?: string;
  idfa?: string;
  idfv?: string;
  iosVersion?: string;
  appsflyerId?: string;
  topupMethod?: string;
  topupAmount?: string;
  pendingLevels?: number[];
  expiresAt: number;
}

const sessions: Record<number, Session> = {};

function getSession(userId: number): Session | undefined {
  const s = sessions[userId];
  if (!s) return undefined;
  if (Date.now() > s.expiresAt) {
    delete sessions[userId];
    return undefined;
  }
  // تجديد الـ timeout مع كل تفاعل
  s.expiresAt = Date.now() + SESSION_TIMEOUT_MS;
  return s;
}

function setSession(userId: number, data: Omit<Session, "expiresAt">) {
  sessions[userId] = { ...data, expiresAt: Date.now() + SESSION_TIMEOUT_MS };
}

// تنظيف الجلسات المنتهية كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  for (const id in sessions) {
    if (now > sessions[Number(id)].expiresAt) delete sessions[Number(id)];
  }
}, 10 * 60 * 1000);

// cache الألعاب في الذاكرة — بتتحمل مرة وحدة
let gamesCache: Awaited<ReturnType<typeof getAllGames>> = [];

export function registerUserHandlers(bot: Bot) {

  // /start
  bot.command("start", async (ctx) => {
    const user = ctx.from!;
    await upsertUser(user.id, user.username, user.first_name);
    delete sessions[user.id];
    await sendMainMenu(ctx, user.first_name);
  });

  // ── ألعابي ──────────────────────────────────────────────
  bot.callbackQuery("show_games", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!gamesCache.length) gamesCache = await getAllGames();
    const keyboard = new InlineKeyboard();
    gamesCache.forEach((g, i) => {
      keyboard.text(`${g.emoji} ${g.name}`, `select_game_${g.id}`);
      if (i % 2 === 1) keyboard.row();
    });
    keyboard.row().text("🔙 رجوع", "back_main");
    await ctx.reply(`🎮 <b>اختر اللعبة اللي بدك تختمها:</b>`, { parse_mode: "HTML", reply_markup: keyboard });
  });

  bot.callbackQuery(/^select_game_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const gameId = Number(ctx.match[1]);
    const game = gamesCache.find(g => Number(g.id) === gameId);
    if (!game) return ctx.reply("❌ لعبة غير موجودة.");
    setSession(user.id, { step: "idfa", gameId, gameName: String(game.name), gameEmoji: String(game.emoji) });
    await ctx.reply(
      `${game.emoji} <b>${game.name}</b>\n\n📋 محتاج منك بعض المعلومات\n\n<b>الخطوة 1/4</b>\nأرسل لي الـ <b>IDFA</b>:`,
      { parse_mode: "HTML" }
    );
  });

  // ── طلباتي ──────────────────────────────────────────────
  bot.callbackQuery("show_orders", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const orders = await getOrdersByUser(user.id);

    if (!orders.length) {
      return ctx.reply("📋 ما عندك طلبات بعد.", {
        reply_markup: new InlineKeyboard().text("🎮 اطلب الآن", "show_games"),
      });
    }

    // جيب كل الليفلات بنفس الوقت بدل loop متسلسل
    const allLevels = await Promise.all(orders.map(o => getOrderLevels(Number(o.id))));

    for (let idx = 0; idx < orders.length; idx++) {
      const o = orders[idx];
      const completedIds = allLevels[idx];
      const doneCount = completedIds.filter(l => Number(l.stamped) === 1).length;
      const totalCount = completedIds.length;
      const statusIcon = o.status === "completed" ? "✅" : "⏳";

      const rows: string[] = [];
      for (let i = 0; i < completedIds.length; i += 4) {
        const chunk = completedIds.slice(i, i + 4);
        rows.push(
          chunk.map(l =>
            Number(l.stamped) === 1
              ? `┃ ✅ ${l.level} ┃`
              : `┃ 🟡 ${l.level} ┃`
          ).join("  ")
        );
      }

      const keyboard = new InlineKeyboard().text("🔙 رجوع", "back_main");
      await ctx.reply(
        `${o.emoji} <b>${o.game_name}</b> ${statusIcon}\n` +
        `📊 ${doneCount}/${totalCount} مكتمل\n\n` +
        `${rows.join("\n")}`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    }
  });

  // ── رصيدي ───────────────────────────────────────────────
  bot.callbackQuery("show_balance", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const balance = await getUserBalance(user.id);
    await ctx.reply(
      `💵 <b>رصيدك الحالي</b>\n\n👤 ${user.first_name}\n💰 <b>${balance.toFixed(2)} دولار</b>`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup").text("🔙 رجوع", "back_main") }
    );
  });

  // ── شحن رصيد ────────────────────────────────────────────
  bot.callbackQuery("show_topup", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`💳 <b>شحن الرصيد</b>\n\nاختر طريقة الدفع:`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("📱 سيريتيل كاش", "topup_syriatel")
        .row()
        .text("🔐 USDT (BEP20)", "topup_usdt")
        .row()
        .text("🔙 رجوع", "back_main"),
    });
  });

  bot.callbackQuery("topup_syriatel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    setSession(user.id, { step: "topup_amount", topupMethod: "syriatel" });
    await ctx.reply(
      `📱 <b>الشحن عبر سيريتيل كاش</b>\n\n` +
      `حوّل المبلغ إلى:\n<code>${SYRIATEL_NUMBER}</code>\n\n` +
      `بعد التحويل أرسل <b>المبلغ بالليرة السورية</b> (مثال: 1400):`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery("topup_usdt", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    setSession(user.id, { step: "topup_amount", topupMethod: "usdt" });
    await ctx.reply(
      `🔐 <b>الشحن عبر USDT (BEP20)</b>\n\n` +
      `أرسل إلى:\n<code>${USDT_ADDRESS}</code>\n\n` +
      `⚠️ <b>BEP20 فقط!</b>\n\n` +
      `بعد التحويل أرسل <b>المبلغ الذي حوّلته</b> (مثال: 10):`,
      { parse_mode: "HTML" }
    );
  });

  // ── تأكيد الطلب ─────────────────────────────────────────
  bot.callbackQuery("confirm_order", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const session = getSession(user.id);
    if (!session || session.step !== "confirm") return ctx.reply("❌ انتهت الجلسة، ابدأ من جديد.");

    const levels = session.pendingLevels!;

    // خصم الرصيد
    const result = await deductBalance(user.id, ORDER_PRICE, `طلب ${session.gameName}`);
    if (!result.ok) {
      delete sessions[user.id];
      return ctx.reply(
        `❌ <b>رصيدك غير كافٍ!</b>\n\n💳 اشحن رصيدك وحاول مجدداً.`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup") }
      );
    }

    // إنشاء الطلب — إذا فشل نرجع الرصيد
    let orderId: number;
    try {
      orderId = await createOrder(user.id, session.gameId!, session.idfa!, session.idfv!, session.iosVersion!, session.appsflyerId!, levels);
    } catch (e) {
      // رجّع الرصيد
      await deductBalance(user.id, -ORDER_PRICE, "استرداد — فشل إنشاء الطلب");
      delete sessions[user.id];
      console.error("createOrder failed:", e);
      return ctx.reply(
        `❌ حدث خطأ أثناء إنشاء الطلب، تم استرداد رصيدك.\nحاول مجدداً أو تواصل مع الدعم.`,
        { reply_markup: new InlineKeyboard().text("🏠 القائمة", "back_main") }
      );
    }

    delete sessions[user.id];

    await ctx.reply(
      `🎉 <b>تم إرسال طلبك!</b>\n\n` +
      `${session.gameEmoji} <b>${session.gameName}</b>\n` +
      `🎯 الليفلات: ${levels.join(", ")}\n` +
      `🔢 رقم الطلب: #${orderId}\n` +
      `💵 رصيدك المتبقي: <b>${result.newBalance.toFixed(2)}$</b>\n\n` +
      `⏳ ستصلك إشعارات مع كل ليفل ✅`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("📋 طلباتي", "show_orders").text("🏠 القائمة", "back_main") }
    );
  });

  // رجوع
  bot.callbackQuery("back_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    delete sessions[user.id];
    await sendMainMenu(ctx, user.first_name);
  });

  // /profile
  bot.command("profile", async (ctx) => {
    const user = ctx.from!;
    const [balance, orders] = await Promise.all([getUserBalance(user.id), getOrdersByUser(user.id)]);
    const completed = orders.filter(o => o.status === "completed").length;
    await ctx.reply(
      `👤 <b>ملفك الشخصي</b>\n\n📋 الطلبات المكتملة: ${completed}/${orders.length}\n💵 الرصيد: <b>${balance.toFixed(2)} دولار</b>`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup").url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`) }
    );
  });

  // ── استقبال الرسائل النصية ───────────────────────────────
  bot.on("message:text", async (ctx) => {
    const user = ctx.from!;
    const session = getSession(user.id);
    if (!session) return;
    const text = ctx.message.text.trim();

    // فلو الطلب
    if (session.step === "idfa") {
      session.idfa = text; session.step = "idfv";
      return ctx.reply(`✅ IDFA تم!\n\n<b>الخطوة 2/4</b>\nأرسل الـ <b>IDFV</b>:`, { parse_mode: "HTML" });
    }
    if (session.step === "idfv") {
      session.idfv = text; session.step = "ios";
      return ctx.reply(`✅ IDFV تم!\n\n<b>الخطوة 3/4</b>\nأرسل <b>إصدار iOS</b> (مثال: 18.2):`, { parse_mode: "HTML" });
    }
    if (session.step === "ios") {
      session.iosVersion = text; session.step = "appsflyer";
      return ctx.reply(`✅ iOS تم!\n\n<b>الخطوة 4/4</b>\nأرسل الـ <b>AppsFlyer ID</b>:`, { parse_mode: "HTML" });
    }
    if (session.step === "appsflyer") {
      session.appsflyerId = text; session.step = "levels";
      return ctx.reply(
        `✅ AppsFlyer ID تم!\n\n🎯 <b>الخطوة الأخيرة!</b>\nأرسل أرقام الليفلات مفصولة بفواصل\n<i>مثال: 1, 5, 10, 15, 20</i>`,
        { parse_mode: "HTML" }
      );
    }
    if (session.step === "levels") {
      const levels = text.split(/[,،\s]+/).map(l => parseInt(l.trim())).filter(l => !isNaN(l) && l > 0);
      if (!levels.length) return ctx.reply("❌ أرسل أرقام صحيحة مثال: 1, 5, 10, 15");
      // تحقق من الرصيد قبل التأكيد
      const balance = await getUserBalance(user.id);
      if (balance < ORDER_PRICE) {
        delete sessions[user.id];
        return ctx.reply(
          `❌ <b>رصيدك غير كافٍ!</b>\n\n💵 رصيدك الحالي: <b>${balance.toFixed(2)}$</b>\n💰 سعر الطلب: <b>${ORDER_PRICE}$</b>\n\nاشحن رصيدك وحاول مجدداً.`,
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup").text("🏠 القائمة", "back_main") }
        );
      }
      // احفظ الليفلات وانتظر تأكيد
      session.step = "confirm";
      session.pendingLevels = levels;
      return ctx.reply(
        `📋 <b>ملخص الطلب</b>\n\n` +
        `${session.gameEmoji} <b>${session.gameName}</b>\n` +
        `🎯 الليفلات: ${levels.join(", ")} (${levels.length} ليفل)\n` +
        `💰 السعر: <b>${ORDER_PRICE}$</b>\n` +
        `💵 رصيدك بعد الطلب: <b>${(balance - ORDER_PRICE).toFixed(2)}$</b>`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("✅ تأكيد الطلب", "confirm_order").text("❌ إلغاء", "back_main") }
      );
    }
    if (session.step === "confirm") {
      // المستخدم كتب بدل ما يضغط الزر — تجاهل
      return;
    }

    // فلو الشحن — المبلغ
    if (session.step === "topup_amount") {
      const raw = text.replace(/[^\d.]/g, "");
      if (!raw || isNaN(Number(raw))) return ctx.reply("❌ أرسل رقم صحيح");
      const SYP_RATE = 140;
      let amountUSD: number;
      let amountDisplay: string;
      if (session.topupMethod === "syriatel") {
        amountUSD = Number(raw) / SYP_RATE;
        amountDisplay = `${Number(raw).toLocaleString()} ل.س = <b>${amountUSD.toFixed(2)}$</b>`;
      } else {
        amountUSD = Number(raw);
        amountDisplay = `<b>${amountUSD.toFixed(2)}$</b>`;
      }
      session.topupAmount = amountUSD.toFixed(2);
      session.step = "topup_proof";
      return ctx.reply(
        `💰 المبلغ: ${amountDisplay}\n\n📸 الآن أرسل <b>رقم العملية</b> أو <b>صورة التحويل</b>:`,
        { parse_mode: "HTML" }
      );
    }

    // فلو الشحن — إثبات نصي
    if (session.step === "topup_proof") {
      const txId = ctx.message.text.trim();
      const reqId = await createTopupRequest(user.id, session.topupMethod!, session.topupAmount!, txId, null);
      delete sessions[user.id];
      return ctx.reply(
        `✅ <b>تم استلام طلب الشحن بنجاح!</b>\n\n` +
        `💰 المبلغ: <b>${session.topupAmount}$</b>\n` +
        `🔢 رقم العملية: <code>${txId}</code>\n` +
        `📋 رقم الطلب: <b>#${reqId}</b>\n\n` +
        `⏳ سيتم مراجعة طلبك وإضافة الرصيد في أقرب وقت ممكن 🙏`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 القائمة", "back_main") }
      );
    }
  });

  // ── استقبال الصور (إثبات الشحن) ─────────────────────────
  bot.on("message:photo", async (ctx) => {
    const user = ctx.from!;
    const session = getSession(user.id);
    if (!session || session.step !== "topup_proof") return;

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const reqId = await createTopupRequest(user.id, session.topupMethod!, session.topupAmount!, null, photoId);
    delete sessions[user.id];

    await ctx.reply(
      `✅ <b>تم استلام طلب الشحن بنجاح!</b>\n\n` +
      `💰 المبلغ: <b>${session.topupAmount}$</b>\n` +
      `🔢 رقم الطلب: <b>#${reqId}</b>\n\n` +
      `⏳ سيتم مراجعة طلبك وإضافة الرصيد في أقرب وقت ممكن 🙏`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 القائمة", "back_main") }
    );
  });

}

async function sendMainMenu(ctx: any, firstName: string) {
  const keyboard = new InlineKeyboard()
    .text("🎮 اطلب لعبة", "show_games").text("📋 طلباتي", "show_orders")
    .row()
    .text("💵 رصيدي", "show_balance").text("💳 شحن رصيد", "show_topup")
    .row()
    .url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`);
  await ctx.reply(
    `💀 الـمُستوى الأخير: نِهاية اللعبة تبدأ من هُنا!

` +
    `أهلاً بك ${firstName} في AutoGamer..
` +
    `المَقر السري لتجهيز الألعاب وسحق المراحل.

` +
    `مع AutoGamer نحن هنا لنختصر عليك الطريق:

` +
    `• أعلى كفاءة وسرعة.
` +
    `• 🏆 قفل ملفات المراحل.

` +
    `الهندسة والتعب علينا.. والسيطرة إلك! 👑`,
    { reply_markup: keyboard }
  );
}
