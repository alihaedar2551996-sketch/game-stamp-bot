import { Bot, InlineKeyboard } from "grammy";
import { upsertUser, getUserProgress, getUserBalance } from "../db/client";

const SUPPORT_USERNAME = "AutoGamers";
const SYRIATEL_NUMBER = "35181383";
const USDT_ADDRESS = "0x77cf846eccb684f524b6a8d357e4dee6ded83a78";

export function registerUserHandlers(bot: Bot) {

  // /start
  bot.command("start", async (ctx) => {
    const user = ctx.from!;
    await upsertUser(user.id, user.username, user.first_name);

    const keyboard = new InlineKeyboard()
      .text("🎮 ألعابي", "show_games")
      .text("💵 رصيدي", "show_balance")
      .row()
      .text("💳 شحن رصيد", "show_topup")
      .url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`);

    await ctx.reply(
      `💀 الـمُستوى الأخير: نِهاية اللعبة تبدأ من هُنا!\n` +
      `أهلاً بك ${user.first_name} في AutoGamer.. المَقر السري لتجهيز الألعاب وسحق المراحل.\n\n` +
      `مع AutoGamer نحن هنا لنختصر عليك الطريق:\n` +
      `• أعلى كفاءة وسرعة.\n` +
      `• 🏆 قفل ملفات المراحل.\n\n` +
      `الهندسة والتعب علينا.. والسيطرة إلك! 👑`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // callback — ألعابي
  bot.callbackQuery("show_games", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const progress = await getUserProgress(user.id);

    if (!progress.length) return ctx.reply("❌ لا توجد ألعاب حتى الآن.");

    let text = `🎮 *ألعابك ومراحلك:*\n\n`;
    for (const g of progress) {
      const done = Number(g.completed_stages);
      const total = Number(g.total_stages);
      const pct = Math.round((done / total) * 100);
      const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
      const status = done === total ? "✅" : done === 0 ? "🔒" : "⏳";
      text += `${g.emoji} *${g.game_name}*\n${status} ${bar} ${done}/${total}\n\n`;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // callback — رصيدي
  bot.callbackQuery("show_balance", async (ctx) => {
    await ctx.answerCallbackQuery();
    const user = ctx.from!;
    const balance = await getUserBalance(user.id);

    const keyboard = new InlineKeyboard()
      .text("💳 شحن رصيد", "show_topup");

    await ctx.reply(
      `💵 *رصيدك الحالي*\n\n` +
      `👤 ${user.first_name}\n` +
      `💰 الرصيد: *${balance.toFixed(2)} دولار*`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // callback — شحن رصيد (اختيار الطريقة)
  bot.callbackQuery("show_topup", async (ctx) => {
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text("📱 سيريتيل كاش", "topup_syriatel")
      .row()
      .text("🔐 USDT (BEP20)", "topup_usdt");

    await ctx.reply(
      `💳 *شحن الرصيد*\n\nاختر طريقة الدفع:`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // callback — سيريتيل كاش
  bot.callbackQuery("topup_syriatel", async (ctx) => {
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .url("🆘 تواصل مع الدعم", `https://t.me/${SUPPORT_USERNAME}`);

    await ctx.reply(
      `📱 *الشحن عبر سيريتيل كاش*\n\n` +
      `1️⃣ افتح تطبيق سيريتيل كاش\n` +
      `2️⃣ أرسل المبلغ المطلوب إلى:\n\n` +
      `\`${SYRIATEL_NUMBER}\`\n\n` +
      `3️⃣ بعد الإرسال تواصل مع الدعم وأرسل:\n` +
      `• المبلغ المحول\n` +
      `• رقمك\n` +
      `• لقطة شاشة للعملية\n\n` +
      `⚡ سيتم إضافة رصيدك خلال دقائق!`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // callback — USDT
  bot.callbackQuery("topup_usdt", async (ctx) => {
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .url("🆘 تواصل مع الدعم", `https://t.me/${SUPPORT_USERNAME}`);

    await ctx.reply(
      `🔐 *الشحن عبر USDT (BEP20)*\n\n` +
      `1️⃣ افتح محفظتك\n` +
      `2️⃣ أرسل USDT على شبكة *BEP20* إلى:\n\n` +
      `\`${USDT_ADDRESS}\`\n\n` +
      `⚠️ *تأكد من اختيار شبكة BEP20 (BSC)*\n` +
      `أي شبكة ثانية = ضياع الأموال!\n\n` +
      `3️⃣ بعد الإرسال تواصل مع الدعم وأرسل:\n` +
      `• المبلغ المحول\n` +
      `• رقم التحويل (TXID)\n\n` +
      `⚡ سيتم إضافة رصيدك بعد التأكيد!`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });

  // /games
  bot.command("games", async (ctx) => {
    const user = ctx.from!;
    const progress = await getUserProgress(user.id);

    if (!progress.length) return ctx.reply("❌ لا توجد ألعاب حتى الآن.");

    let text = `🎮 *ألعابك ومراحلك:*\n\n`;
    for (const g of progress) {
      const done = Number(g.completed_stages);
      const total = Number(g.total_stages);
      const pct = Math.round((done / total) * 100);
      const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
      const status = done === total ? "✅" : done === 0 ? "🔒" : "⏳";
      text += `${g.emoji} *${g.game_name}*\n${status} ${bar} ${done}/${total}\n\n`;
    }

    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // /profile
  bot.command("profile", async (ctx) => {
    const user = ctx.from!;
    const [progress, balance] = await Promise.all([
      getUserProgress(user.id),
      getUserBalance(user.id),
    ]);

    const totalGames = progress.length;
    const completedGames = progress.filter(g => Number(g.completed_stages) === Number(g.total_stages)).length;
    const totalStamps = progress.reduce((sum, g) => sum + Number(g.completed_stages), 0);

    const keyboard = new InlineKeyboard()
      .text("💳 شحن رصيد", "show_topup")
      .url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`);

    await ctx.reply(
      `👤 *ملفك الشخصي*\n\n` +
      `🏆 الألعاب المكتملة: ${completedGames}/${totalGames}\n` +
      `🎯 إجمالي التختيمات: ${totalStamps}\n` +
      `💵 الرصيد: *${balance.toFixed(2)} دولار*\n\n` +
      `استمر وأكمل جميع المراحل! 💪`,
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
  });
}
