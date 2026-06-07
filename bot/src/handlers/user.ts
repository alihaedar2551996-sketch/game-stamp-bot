import { Bot, InlineKeyboard } from "grammy";
import { upsertUser, getAllGames, getUserBalance, createOrder, getOrdersByUser } from "../db/client";

const SUPPORT_USERNAME = "AutoGamers";
const SYRIATEL_NUMBER = "35181383";
const USDT_ADDRESS = "0x77cf846eccb684f524b6a8d357e4dee6ded83a78";

// حفظ مؤقت لبيانات الطلب (في الذاكرة — كافي لبوت صغير)
const sessions: Record<number, {
  step: string;
  gameId?: number;
  gameName?: string;
  gameEmoji?: string;
  idfa?: string;
  idfv?: string;
  iosVersion?: string;
  appsflyerId?: string;
}> = {};

export function registerUserHandlers(bot: Bot) {

  // /start
  bot.command("start", async (ctx) => {
    const user = ctx.from!;
    await upsertUser(user.id, user.username, user.first_name);
    delete sessions[user.id];
    await sendMainMenu(ctx, user.first_name);
  });

  // callback — ألعابي: قائمة الألعاب
  bot.callbackQuery("show_games", async (ctx) => {
    await ctx.answerCallbackQuery();
    const games = await getAllGames();
    const keyboard = new InlineKeyboard();
    games.forEach((g, i) => {
      keyboard.text(`${g.emoji} ${g.name}`, `select_game_${g.id}`);
      if (i % 2 === 1) keyboard.row();
    });
    keyboard.row().text("🔙 رجوع", "back_main");
    await ctx.reply(`🎮 *اختر اللعبة اللي بدك تختمها:*`, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  });

  // callback — اختيار لعبة → بدء الطلب
  bot.callbackQuery(/^select_game_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const gameId = Number(ctx.match[1]);
    const games = await getAllGames();
    const game = games.find(g => Number(g.id) === gameId);
    if (!game) return ctx.reply("❌ لعبة غير موجودة.");

    sessions[user.id] = { step: "idfa", gameId, gameName: String(game.name), gameEmoji: String(game.emoji) };

    await ctx.reply(
      `${game.emoji} *${game.name}*\n\n` +
      `ممتاز! هلق محتاج منك بعض المعلومات 📋\n\n` +
      `*الخطوة 1/4*\n` +
      `أرسل لي الـ *IDFA* الخاص بجهازك:`,
      { parse_mode: "Markdown" }
    );
  });

  // callback — طلباتي
  bot.callbackQuery("show_orders", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const orders = await getOrdersByUser(user.id);

    if (!orders.length) {
      const keyboard = new InlineKeyboard().text("🎮 اطلب الآن", "show_games");
      return ctx.reply("📋 ما عندك طلبات بعد.", { reply_markup: keyboard });
    }

    let text = `📋 *طلباتك:*\n\n`;
    for (const o of orders) {
      const statusIcon = o.status === "completed" ? "✅" : o.status === "pending" ? "⏳" : "🔄";
      const levels = String(o.levels).split(",").join(", ");
      text += `${o.emoji} *${o.game_name}*\n`;
      text += `${statusIcon} الحالة: ${o.status === "completed" ? "مكتمل" : "قيد التنفيذ"}\n`;
      text += `🎯 الليفلات: ${levels}\n\n`;
    }

    const keyboard = new InlineKeyboard().text("🔙 رجوع", "back_main");
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // callback — رصيدي
  bot.callbackQuery("show_balance", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const balance = await getUserBalance(user.id);
    const keyboard = new InlineKeyboard()
      .text("💳 شحن رصيد", "show_topup")
      .text("🔙 رجوع", "back_main");
    await ctx.reply(
      `💵 *رصيدك الحالي*\n\n👤 ${user.first_name}\n💰 *${balance.toFixed(2)} دولار*`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // callback — شحن رصيد
  bot.callbackQuery("show_topup", async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text("📱 سيريتيل كاش", "topup_syriatel")
      .row()
      .text("🔐 USDT (BEP20)", "topup_usdt")
      .row()
      .text("🔙 رجوع", "back_main");
    await ctx.reply(`💳 *شحن الرصيد*\n\nاختر طريقة الدفع:`, {
      parse_mode: "Markdown", reply_markup: keyboard,
    });
  });

  bot.callbackQuery("topup_syriatel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard().url("🆘 تواصل مع الدعم", `https://t.me/${SUPPORT_USERNAME}`);
    await ctx.reply(
      `📱 *الشحن عبر سيريتيل كاش*\n\n` +
      `1️⃣ افتح تطبيق سيريتيل كاش\n` +
      `2️⃣ أرسل المبلغ إلى:\n\n\`${SYRIATEL_NUMBER}\`\n\n` +
      `3️⃣ تواصل مع الدعم وأرسل:\n• المبلغ\n• رقمك\n• لقطة شاشة\n\n` +
      `⚡ سيتم إضافة رصيدك خلال دقائق!`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  bot.callbackQuery("topup_usdt", async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard().url("🆘 تواصل مع الدعم", `https://t.me/${SUPPORT_USERNAME}`);
    await ctx.reply(
      `🔐 *الشحن عبر USDT (BEP20)*\n\n` +
      `1️⃣ افتح محفظتك\n` +
      `2️⃣ أرسل USDT على شبكة *BEP20* إلى:\n\n\`${USDT_ADDRESS}\`\n\n` +
      `⚠️ *BEP20 فقط — أي شبكة ثانية = ضياع الأموال!*\n\n` +
      `3️⃣ تواصل مع الدعم وأرسل:\n• المبلغ\n• رقم التحويل (TXID)\n\n` +
      `⚡ سيتم إضافة رصيدك بعد التأكيد!`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // callback — رجوع للقائمة الرئيسية
  bot.callbackQuery("back_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    delete sessions[user.id];
    await sendMainMenu(ctx, user.first_name);
  });

  // /profile
  bot.command("profile", async (ctx) => {
    const user = ctx.from!;
    const [balance, orders] = await Promise.all([
      getUserBalance(user.id),
      getOrdersByUser(user.id),
    ]);
    const completed = orders.filter(o => o.status === "completed").length;
    const keyboard = new InlineKeyboard()
      .text("💳 شحن رصيد", "show_topup")
      .url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`);
    await ctx.reply(
      `👤 *ملفك الشخصي*\n\n` +
      `📋 الطلبات المكتملة: ${completed}/${orders.length}\n` +
      `💵 الرصيد: *${balance.toFixed(2)} دولار*`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // ── استقبال الرسائل النصية لجمع بيانات الطلب ──
  bot.on("message:text", async (ctx) => {
    const user = ctx.from!;
    const session = sessions[user.id];
    if (!session) return;

    const text = ctx.message.text.trim();

    if (session.step === "idfa") {
      session.idfa = text;
      session.step = "idfv";
      await ctx.reply(
        `✅ IDFA تم استلامه!\n\n*الخطوة 2/4*\nأرسل لي الـ *IDFV*:`,
        { parse_mode: "Markdown" }
      );

    } else if (session.step === "idfv") {
      session.idfv = text;
      session.step = "ios";
      await ctx.reply(
        `✅ IDFV تم استلامه!\n\n*الخطوة 3/4*\nأرسل لي *إصدار iOS* (مثال: 18.2):`,
        { parse_mode: "Markdown" }
      );

    } else if (session.step === "ios") {
      session.iosVersion = text;
      session.step = "appsflyer";
      await ctx.reply(
        `✅ iOS version تم استلامه!\n\n*الخطوة 4/4*\nأرسل لي الـ *AppsFlyer ID*:`,
        { parse_mode: "Markdown" }
      );

    } else if (session.step === "appsflyer") {
      session.appsflyerId = text;
      session.step = "levels";
      await ctx.reply(
        `✅ AppsFlyer ID تم استلامه!\n\n` +
        `🎯 *الخطوة الأخيرة!*\n` +
        `أرسل لي أرقام الليفلات اللي بدك تختمها\n` +
        `*(مفصولة بفواصل — مثال: 1, 5, 10, 15, 20)*`,
        { parse_mode: "Markdown" }
      );

    } else if (session.step === "levels") {
      // تحليل الليفلات
      const levels = text.split(/[,،\s]+/)
        .map(l => parseInt(l.trim()))
        .filter(l => !isNaN(l) && l > 0);

      if (!levels.length) {
        return ctx.reply("❌ أرسل أرقام ليفلات صحيحة مفصولة بفواصل.\nمثال: 1, 5, 10, 15");
      }

      // إنشاء الطلب
      const orderId = await createOrder(
        user.id, session.gameId!,
        session.idfa!, session.idfv!, session.iosVersion!, session.appsflyerId!,
        levels
      );

      delete sessions[user.id];

      const keyboard = new InlineKeyboard()
        .text("📋 طلباتي", "show_orders")
        .text("🏠 القائمة", "back_main");

      await ctx.reply(
        `🎉 *تم إرسال طلبك بنجاح!*\n\n` +
        `${session.gameEmoji} *${session.gameName}*\n` +
        `🎯 الليفلات: ${levels.join(", ")}\n` +
        `🔢 رقم الطلب: #${orderId}\n\n` +
        `⏳ سيتم البدء بتختيم مراحلك قريباً!\n` +
        `ستصلك إشعارات فورية مع كل ليفل ✅`,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
    }
  });
}

async function sendMainMenu(ctx: any, firstName: string) {
  const keyboard = new InlineKeyboard()
    .text("🎮 اطلب لعبة", "show_games")
    .text("📋 طلباتي", "show_orders")
    .row()
    .text("💵 رصيدي", "show_balance")
    .text("💳 شحن رصيد", "show_topup")
    .row()
    .url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`);

  await ctx.reply(
    `💀 الـمُستوى الأخير: نِهاية اللعبة تبدأ من هُنا!\n` +
    `أهلاً بك ${firstName} في AutoGamer.. المَقر السري لتجهيز الألعاب وسحق المراحل.\n\n` +
    `مع AutoGamer نحن هنا لنختصر عليك الطريق:\n` +
    `• أعلى كفاءة وسرعة.\n` +
    `• 🏆 قفل ملفات المراحل.\n\n` +
    `الهندسة والتعب علينا.. والسيطرة إلك! 👑`,
    { parse_mode: "Markdown", reply_markup: keyboard }
  );
}
