import { Bot, InlineKeyboard } from "grammy";
import { upsertUser, getUserProgress, getStagesByGame, getCompletedStages } from "../db/client";

export function registerUserHandlers(bot: Bot) {

  // /start — تسجيل وعرض الألعاب
  bot.command("start", async (ctx) => {
    const user = ctx.from!;
    await upsertUser(user.id, user.username, user.first_name);

    await ctx.reply(
      `🎮 *أهلاً ${user.first_name}!*\n\nمرحباً في بوت تختيم المراحل.\nالأدمن سيختم مراحلك في كل لعبة وستصلك إشعار فوري! 🔔\n\nاستخدم /games لعرض ألعابك`,
      { parse_mode: "Markdown" }
    );
  });

  // /games — عرض تقدم المستخدم
  bot.command("games", async (ctx) => {
    const user = ctx.from!;
    const progress = await getUserProgress(user.id);

    if (!progress.length) {
      return ctx.reply("❌ لا توجد ألعاب حتى الآن.");
    }

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

  // /profile — ملخص المستخدم
  bot.command("profile", async (ctx) => {
    const user = ctx.from!;
    const progress = await getUserProgress(user.id);

    const totalGames = progress.length;
    const completedGames = progress.filter(g => Number(g.completed_stages) === Number(g.total_stages)).length;
    const totalStamps = progress.reduce((sum, g) => sum + Number(g.completed_stages), 0);

    await ctx.reply(
      `👤 *ملفك الشخصي*\n\n` +
      `🏆 الألعاب المكتملة: ${completedGames}/${totalGames}\n` +
      `🎯 إجمالي التختيمات: ${totalStamps}\n\n` +
      `استمر وأكمل جميع المراحل! 💪`,
      { parse_mode: "Markdown" }
    );
  });
}
