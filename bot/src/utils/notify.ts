import { Bot } from "grammy";
import { isGameComplete } from "../db/client";

// FIX #5: التحقق الفعلي من قاعدة البيانات بدل مقارنة رقم المرحلة
export async function notifyStageComplete(
  bot: Bot,
  tgId: number,
  gameEmoji: string,
  gameName: string,
  stageNumber: number,
  stageName: string,
  totalStages: number,
  gameId: number
) {
  const gameComplete = await isGameComplete(tgId, gameId, totalStages);

  if (gameComplete) {
    await bot.api.sendMessage(
      tgId,
      `🎉 *مبروك! أكملت لعبة ${gameEmoji} ${gameName} بالكامل!*\n\n` +
      `✅ اجتزت جميع المراحل الـ${totalStages}!\n` +
      `أنت بطل حقيقي! 🏆`,
      { parse_mode: "Markdown" }
    );
  } else {
    await bot.api.sendMessage(
      tgId,
      `🏅 *تم تختيم مرحلة جديدة!*\n\n` +
      `${gameEmoji} اللعبة: *${gameName}*\n` +
      `✅ المرحلة: *${stageName}* (${stageNumber}/${totalStages})\n\n` +
      `استمر! باقي ${totalStages - stageNumber} مرحلة 💪`,
      { parse_mode: "Markdown" }
    );
  }
}
