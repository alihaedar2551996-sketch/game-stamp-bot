import { Bot, InlineKeyboard } from "grammy";
import { upsertUser, getAllGames, getUserBalance, createOrder, getOrdersByUser, getOrderLevels, createTopupRequest } from "../db/client";

const SUPPORT_USERNAME = "AutoGamers";
const SYRIATEL_NUMBER = "35181383";
const USDT_ADDRESS = "0x77cf846eccb684f524b6a8d357e4dee6ded83a78";

const sessions: Record<number, {
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
}> = {};

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
    const games = await getAllGames();
    const keyboard = new InlineKeyboard();
    games.forEach((g, i) => {
      keyboard.text(`${g.emoji} ${g.name}`, `select_game_${g.id}`);
      if (i % 2 === 1) keyboard.row();
    });
    keyboard.row().text("🔙 رجوع", "back_main");
    await ctx.reply(`🎮 *اختر اللعبة اللي بدك تختمها:*`, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.callbackQuery(/^select_game_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const gameId = Number(ctx.match[1]);
    const games = await getAllGames();
    const game = games.find(g => Number(g.id) === gameId);
    if (!game) return ctx.reply("❌ لعبة غير موجودة.");
    sessions[user.id] = { step: "idfa", gameId, gameName: String(game.name), gameEmoji: String(game.emoji) };
    await ctx.reply(
      `${game.emoji} *${game.name}*\n\n📋 محتاج منك بعض المعلومات\n\n*الخطوة 1/4*\nأرسل لي الـ *IDFA*:`,
      { parse_mode: "Markdown" }
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

    // عرض كل لعبة لحالها
    for (const o of orders) {
      const levels = String(o.levels).split(",").map(Number);
      const completedIds = await getOrderLevels(Number(o.id));

      const doneCount = completedIds.filter(l => Number(l.stamped) === 1).length;
      const totalCount = completedIds.length;
      const statusIcon = o.status === "completed" ? "✅" : "⏳";

      // كل ليفل بمربع مع فاصل
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
        `${o.emoji} *${o.game_name}* ${statusIcon}\n` +
        `📊 ${doneCount}/${totalCount} مكتمل\n\n` +
        `${rows.join("\n")}`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
    }
  });

  // ── رصيدي ───────────────────────────────────────────────
  bot.callbackQuery("show_balance", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const balance = await getUserBalance(user.id);
    await ctx.reply(
      `💵 *رصيدك الحالي*\n\n👤 ${user.first_name}\n💰 *${balance.toFixed(2)} دولار*`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup").text("🔙 رجوع", "back_main") }
    );
  });

  // ── شحن رصيد: اختيار الطريقة ────────────────────────────
  bot.callbackQuery("show_topup", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(`💳 *شحن الرصيد*\n\nاختر طريقة الدفع:`, {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("📱 سيريتيل كاش", "topup_syriatel")
        .row()
        .text("🔐 USDT (BEP20)", "topup_usdt")
        .row()
        .text("🔙 رجوع", "back_main"),
    });
  });

  // سيريتيل كاش — عرض المعلومات وطلب المبلغ
  bot.callbackQuery("topup_syriatel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    sessions[user.id] = { step: "topup_amount", topupMethod: "syriatel" };
    await ctx.reply(
      `📱 *الشحن عبر سيريتيل كاش*\n\n` +
      `حوّل المبلغ إلى:\n\`${SYRIATEL_NUMBER}\`\n\n` +
      `بعد التحويل أرسل *المبلغ بالليرة السورية* (مثال: 1400):`,
      { parse_mode: "Markdown" }
    );
  });

  // USDT — عرض المعلومات وطلب المبلغ
  bot.callbackQuery("topup_usdt", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    sessions[user.id] = { step: "topup_amount", topupMethod: "usdt" };
    await ctx.reply(
      `🔐 *الشحن عبر USDT (BEP20)*\n\n` +
      `أرسل إلى:\n\`${USDT_ADDRESS}\`\n\n` +
      `⚠️ *BEP20 فقط!*\n\n` +
      `بعد التحويل أرسل *المبلغ الذي حوّلته* (مثال: 10):`,
      { parse_mode: "Markdown" }
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
      `👤 *ملفك الشخصي*\n\n📋 الطلبات المكتملة: ${completed}/${orders.length}\n💵 الرصيد: *${balance.toFixed(2)} دولار*`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup").url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`) }
    );
  });

  // ── استقبال الرسائل النصية ───────────────────────────────
  bot.on("message:text", async (ctx) => {
    const user = ctx.from!;
    const session = sessions[user.id];
    if (!session) return;
    const text = ctx.message.text.trim();

    // فلو الطلب
    if (session.step === "idfa") {
      session.idfa = text; session.step = "idfv";
      return ctx.reply(`✅ IDFA تم!\n\n*الخطوة 2/4*\nأرسل الـ *IDFV*:`, { parse_mode: "Markdown" });
    }
    if (session.step === "idfv") {
      session.idfv = text; session.step = "ios";
      return ctx.reply(`✅ IDFV تم!\n\n*الخطوة 3/4*\nأرسل *إصدار iOS* (مثال: 18.2):`, { parse_mode: "Markdown" });
    }
    if (session.step === "ios") {
      session.iosVersion = text; session.step = "appsflyer";
      return ctx.reply(`✅ iOS تم!\n\n*الخطوة 4/4*\nأرسل الـ *AppsFlyer ID*:`, { parse_mode: "Markdown" });
    }
    if (session.step === "appsflyer") {
      session.appsflyerId = text; session.step = "levels";
      return ctx.reply(
        `✅ AppsFlyer ID تم!\n\n🎯 *الخطوة الأخيرة!*\nأرسل أرقام الليفلات مفصولة بفواصل\n*(مثال: 1, 5, 10, 15, 20)*`,
        { parse_mode: "Markdown" }
      );
    }
    if (session.step === "levels") {
      const levels = text.split(/[,،\s]+/).map(l => parseInt(l.trim())).filter(l => !isNaN(l) && l > 0);
      if (!levels.length) return ctx.reply("❌ أرسل أرقام صحيحة مثال: 1, 5, 10, 15");
      const orderId = await createOrder(user.id, session.gameId!, session.idfa!, session.idfv!, session.iosVersion!, session.appsflyerId!, levels);
      delete sessions[user.id];
      return ctx.reply(
        `🎉 *تم إرسال طلبك!*\n\n${session.gameEmoji} *${session.gameName}*\n🎯 الليفلات: ${levels.join(", ")}\n🔢 رقم الطلب: #${orderId}\n\n⏳ ستصلك إشعارات مع كل ليفل ✅`,
        { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📋 طلباتي", "show_orders").text("🏠 القائمة", "back_main") }
      );
    }

    // فلو الشحن — المبلغ
    if (session.step === "topup_amount") {
      const raw = text.replace(/[^\d.]/g, "");
      if (!raw || isNaN(Number(raw))) return ctx.reply("❌ أرسل رقم صحيح");
      const SYP_RATE = 140; // 140 ليرة = 1 دولار
      let amountUSD: number;
      let amountDisplay: string;
      if (session.topupMethod === "syriatel") {
        amountUSD = Number(raw) / SYP_RATE;
        amountDisplay = `${Number(raw).toLocaleString()} ل.س = *${amountUSD.toFixed(2)}$*`;
      } else {
        amountUSD = Number(raw);
        amountDisplay = `*${amountUSD.toFixed(2)}$*`;
      }
      session.topupAmount = amountUSD.toFixed(2);
      session.step = "topup_proof";
      return ctx.reply(
        `💰 المبلغ: ${amountDisplay}\n\n📸 الآن أرسل *رقم العملية* أو *صورة التحويل*:`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // ── استقبال الصور (إثبات الشحن) ─────────────────────────
  bot.on("message:photo", async (ctx) => {
    const user = ctx.from!;
    const session = sessions[user.id];
    if (!session || session.step !== "topup_proof") return;

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    const reqId = await createTopupRequest(user.id, session.topupMethod!, session.topupAmount!, null, photoId);
    delete sessions[user.id];

    await ctx.reply(
      `✅ *تم استلام طلب الشحن بنجاح!*\n\n` +
      `💰 المبلغ: *${session.topupAmount}$*\n` +
      `🔢 رقم الطلب: *#${reqId}*\n\n` +
      `⏳ سيتم مراجعة طلبك وإضافة الرصيد في أقرب وقت ممكن 🙏`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🏠 القائمة", "back_main") }
    );
  });

  // استقبال نص كـ proof (رقم العملية)
  bot.on("message:text", async (ctx) => {
    const user = ctx.from!;
    const session = sessions[user.id];
    if (!session || session.step !== "topup_proof") return;

    const txId = ctx.message.text.trim();
    const reqId = await createTopupRequest(user.id, session.topupMethod!, session.topupAmount!, txId, null);
    delete sessions[user.id];

    await ctx.reply(
      `✅ *تم استلام طلب الشحن بنجاح!*\n\n` +
      `💰 المبلغ: *${session.topupAmount}$*\n` +
      `🔢 رقم العملية: \`${txId}\`\n` +
      `📋 رقم الطلب: *#${reqId}*\n\n` +
      `⏳ سيتم مراجعة طلبك وإضافة الرصيد في أقرب وقت ممكن 🙏`,
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🏠 القائمة", "back_main") }
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
    `💀 الـمُستوى الأخير: نِهاية اللعبة تبدأ من هُنا!\n\n` +
    `أهلاً بك ${firstName} في AutoGamer..\n` +
    `المَقر السري لتجهيز الألعاب وسحق المراحل.\n\n` +
    `مع AutoGamer نحن هنا لنختصر عليك الطريق:\n\n` +
    `• أعلى كفاءة وسرعة.\n` +
    `• 🏆 قفل ملفات المراحل.\n\n` +
    `الهندسة والتعب علينا.. والسيطرة إلك! 👑`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}
