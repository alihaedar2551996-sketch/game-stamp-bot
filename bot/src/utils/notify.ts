import { Bot } from "grammy";

// إشعار المستخدم عند تختيم مرحلة
export async function notifyStageComplete(
  bot: Bot,
  tgId: number,
  gameEmoji: string,
  gameName: string,
  stageNumber: number,
  stageName: string,
  totalStages: number
) {
  const isLastStage = stageNumber === totalStages;

  if (isLastStage) {
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
