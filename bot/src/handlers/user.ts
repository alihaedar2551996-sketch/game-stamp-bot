import { Bot, InlineKeyboard } from "grammy";
import { upsertUser, getAllGames, getUserBalance, deductBalance, addBalance, createOrder, getOrdersByUser, getOrderLevels, getOrder, createTopupRequest, setReferral, getUserReferralInfo } from "../db/client";
import { bot } from "../index";

const ADMIN_CHAT_ID = Number(process.env.ADMIN_CHAT_ID ?? "6762566920");
async function notifyAdmin(msg: string) {
  try { await bot.api.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: "HTML" }); } catch {}
}

const SUPPORT_USERNAME = "AutoGamers";
const SYRIATEL_NUMBER = "35181383";
const USDT_ADDRESS = "0x77cf846eccb684f524b6a8d357e4dee6ded83a78";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 دقيقة
const PRICE_PER_LEVEL = 0.15; // سعر الليفل الواحد بالدولار

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
  pendingPrice?: number;
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
    const isNew = await upsertUser(user.id, user.username, user.first_name);
    delete sessions[user.id];

    // معالجة رابط الإحالة /start?ref=123456
    const payload = ctx.match?.trim();
    if (payload && /^\d+$/.test(payload)) {
      const referrerId = Number(payload);
      await setReferral(referrerId, user.id);
    }

    // هدية ترحيبية للمستخدمين الجدد
    if (isNew) {
      await addBalance(user.id, 1, "🎁 هدية ترحيبية للمستخدمين الجدد");
      await ctx.reply(
        `🎁 <b>مبروك! حصلت على هدية ترحيبية!</b>\n\n` +
        `💵 تم إضافة <b>1.00$</b> لرصيدك كهدية ترحيبية\n\n` +
        `ابدأ الآن واطلب أول لعبة! 🎮`,
        { parse_mode: "HTML" }
      );
    }

    await sendMainMenu(ctx, user.first_name);
  });

  // ── ألعابي ──────────────────────────────────────────────
  bot.callbackQuery("show_games", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
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
    ctx.answerCallbackQuery().catch(() => {});
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

  // ── ألعابي ───────────────────────────────────────────────
  bot.callbackQuery("show_orders", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    const user = ctx.from!;
    await sendOrdersList(ctx, user.id);
  });

  // تفاصيل أوردر واحد
  bot.callbackQuery(/^order_detail_(\d+)$/, async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    const orderId = Number(ctx.match[1]);
    await sendOrderDetail(ctx, orderId);
  });

  // ── رصيدي ───────────────────────────────────────────────
  bot.callbackQuery("show_balance", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    const user = ctx.from!;
    const balance = await getUserBalance(user.id);
    await ctx.reply(
      `💵 <b>رصيدك الحالي</b>\n\n👤 ${user.first_name}\n💰 <b>${balance.toFixed(2)} دولار</b>`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup").text("🔙 رجوع", "back_main") }
    );
  });

  // ── شحن رصيد ────────────────────────────────────────────
  bot.callbackQuery("show_topup", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
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
    ctx.answerCallbackQuery().catch(() => {});
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
    ctx.answerCallbackQuery().catch(() => {});
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
    ctx.answerCallbackQuery().catch(() => {});
    const user = ctx.from!;
    const session = getSession(user.id);
    if (!session || session.step !== "confirm") return ctx.reply("❌ انتهت الجلسة، ابدأ من جديد.");

    const levels = session.pendingLevels!;

    // خصم الرصيد
    const orderPrice = session.pendingPrice ?? parseFloat((session.pendingLevels!.length * PRICE_PER_LEVEL).toFixed(2));
    const result = await deductBalance(user.id, orderPrice, `طلب ${session.gameName}`);
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
      await deductBalance(user.id, -orderPrice, "استرداد — فشل إنشاء الطلب");
      delete sessions[user.id];
      console.error("createOrder failed:", e);
      return ctx.reply(
        `❌ حدث خطأ أثناء إنشاء الطلب، تم استرداد رصيدك.\nحاول مجدداً أو تواصل مع الدعم.`,
        { reply_markup: new InlineKeyboard().text("🏠 القائمة", "back_main") }
      );
    }

    delete sessions[user.id];

    // إشعار الأدمن بطلب جديد
    await notifyAdmin(
      `🆕 <b>طلب جديد #${orderId}</b>\n` +
      `${session.gameEmoji} <b>${session.gameName}</b>\n` +
      `👤 ${ctx.from!.first_name}${ctx.from!.username ? ` (@${ctx.from!.username})` : ""}\n` +
      `🎯 الليفلات: ${levels.join(", ")}\n` +
      `💰 السعر: ${session.pendingPrice?.toFixed(2)}$`
    );

    await ctx.reply(
      `🎉 <b>تم إرسال طلبك!</b>\n\n` +
      `${session.gameEmoji} <b>${session.gameName}</b>\n` +
      `🎯 الليفلات: ${levels.join(", ")}\n` +
      `🔢 رقم الطلب: #${orderId}\n` +
      `💵 رصيدك المتبقي: <b>${result.newBalance.toFixed(2)}$</b>\n\n` +
      `⏳ ستصلك إشعارات مع كل ليفل ✅`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🎮 ألعابي", "show_orders").text("🏠 القائمة", "back_main") }
    );
  });

  // رجوع
  bot.callbackQuery("back_main", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    const user = ctx.from!;
    delete sessions[user.id];
    await sendMainMenu(ctx, user.first_name);
  });

  // ── دعوة صديق ────────────────────────────────────────────
  bot.callbackQuery("invite_friend", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    const user = ctx.from!;
    const botUsername = (await ctx.api.getMe()).username;
    const inviteLink = `https://t.me/${botUsername}?start=${user.id}`;
    const info = await getUserReferralInfo(user.id);

    await ctx.reply(
      `🎁 <b>دعوة صديق</b>\n\n` +
      `🔗 رابط الدعوة الخاص بك:\n<code>${inviteLink}</code>\n\n` +
      `💰 تربح <b>10%</b> من كل شحن يشحنه صديقك\n\n` +
      `📊 <b>إحصائياتك:</b>\n` +
      `👥 أصدقاء مدعوون: <b>${info.referred.length}</b>\n` +
      `💵 إجمالي العمولات: <b>${info.totalCommission.toFixed(2)}$</b>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .url("📤 شارك الرابط", `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent("انضم لـ AutoGamer واحصل على خدمة ختم المراحل 🎮")}`)
          .row()
          .text("🏠 القائمة", "back_main"),
      }
    );
  });

  // ── التعليمات ──────────────────────────────────────────────
  bot.callbackQuery("help_menu", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      `📖 <b>مركز المساعدة</b>\n\nاختر الموضوع اللي تبي تعرف عنه:`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🕹️ كيف تطلب لعبة", "help_order").row()
          .text("📱 شو هو IDFA/IDFV/AppsFlyer", "help_ids").row()
          .text("💳 كيف تشحن الرصيد", "help_topup").row()
          .text("💰 الأسعار", "help_prices").row()
          .text("🎁 نظام الإحالة", "help_referral").row()
          .text("🏠 القائمة", "back_main"),
      }
    );
  });

  bot.callbackQuery("help_order", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      `🕹️ <b>كيف تطلب لعبة؟</b>\n\n` +
      `<b>الخطوة 1</b> — اضغط <b>اطلب لعبة</b> من القائمة\n` +
      `<b>الخطوة 2</b> — اختر اللعبة اللي بدك تختمها\n` +
      `<b>الخطوة 3</b> — أرسل معلوماتك:\n` +
      `   • IDFA\n` +
      `   • IDFV\n` +
      `   • إصدار iOS (مثال: 18.2)\n` +
      `   • AppsFlyer ID\n` +
      `<b>الخطوة 4</b> — أرسل أرقام الليفلات مفصولة بفواصل\n` +
      `   مثال: <code>1, 5, 10, 15, 20</code>\n` +
      `<b>الخطوة 5</b> — راجع الملخص واضغط ✅ تأكيد\n\n` +
      `⏳ بعد التأكيد ستصلك إشعارات مع كل ليفل يُختم`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔙 التعليمات", "help_menu").text("🏠 القائمة", "back_main"),
      }
    );
  });

  bot.callbackQuery("help_ids", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      `📱 <b>شو هو IDFA / IDFV / AppsFlyer ID؟</b>\n\n` +
      `هي معرّفات خاصة بجهازك وحسابك في اللعبة — بدونها ما نقدر نختم ليفلاتك.\n\n` +
      `<b>🔹 IDFA</b> (Identifier for Advertisers)\n` +
      `معرّف الإعلانات الخاص بجهازك\n` +
      `📍 الإعدادات ← الخصوصية والأمان ← الإعلانات من Apple\n\n` +
      `<b>🔹 IDFV</b> (Identifier for Vendor)\n` +
      `معرّف المطور — موجود داخل اللعبة في قسم الإعدادات أو الدعم\n\n` +
      `<b>🔹 AppsFlyer ID</b>\n` +
      `معرّف التتبع — موجود في إعدادات اللعبة تحت "معلومات الجهاز" أو "Device Info"\n\n` +
      `💡 <i>إذا ما لقيتها تواصل مع الدعم وبنساعدك</i>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔙 التعليمات", "help_menu").text("🏠 القائمة", "back_main"),
      }
    );
  });

  bot.callbackQuery("help_topup", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      `💳 <b>كيف تشحن رصيدك؟</b>\n\n` +
      `<b>طريقة 1 — سيريتيل كاش 📱</b>\n` +
      `1. حوّل المبلغ إلى: <code>35181383</code>\n` +
      `2. اضغط شحن رصيد ← سيريتيل كاش\n` +
      `3. أرسل المبلغ بالليرة السورية (مثال: <code>1400</code>)\n` +
      `4. أرسل رقم العملية أو صورة التحويل\n\n` +
      `<b>طريقة 2 — USDT (BEP20) 🔐</b>\n` +
      `1. أرسل USDT إلى:\n<code>0x77cf846eccb684f524b6a8d357e4dee6ded83a78</code>\n` +
      `⚠️ <b>BEP20 فقط!</b> شبكات أخرى = خسارة المبلغ\n` +
      `2. اضغط شحن رصيد ← USDT\n` +
      `3. أرسل المبلغ ثم TX Hash\n\n` +
      `⏳ يتم مراجعة الطلب وإضافة الرصيد في أقرب وقت`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔙 التعليمات", "help_menu").text("🏠 القائمة", "back_main"),
      }
    );
  });

  bot.callbackQuery("help_prices", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      `💰 <b>الأسعار</b>\n\n` +
      `<b>سعر الليفل الواحد: ${PRICE_PER_LEVEL}$</b>\n\n` +
      `📊 <b>أمثلة:</b>\n` +
      `• 5 ليفلات = <b>${(5 * PRICE_PER_LEVEL).toFixed(2)}$</b>\n` +
      `• 10 ليفلات = <b>${(10 * PRICE_PER_LEVEL).toFixed(2)}$</b>\n` +
      `• 20 ليفلات = <b>${(20 * PRICE_PER_LEVEL).toFixed(2)}$</b>\n` +
      `• 50 ليفلات = <b>${(50 * PRICE_PER_LEVEL).toFixed(2)}$</b>\n\n` +
      `💡 السعر يُخصم من رصيدك مباشرة عند تأكيد الطلب`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🔙 التعليمات", "help_menu").text("🏠 القائمة", "back_main"),
      }
    );
  });

  bot.callbackQuery("help_referral", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    const botUsername = (await ctx.api.getMe()).username;
    const user = ctx.from!;
    const inviteLink = `https://t.me/${botUsername}?start=${user.id}`;
    await ctx.reply(
      `🎁 <b>نظام الإحالة</b>\n\n` +
      `ادعُ أصدقاءك واربح <b>10%</b> من كل شحن يشحنونه!\n\n` +
      `<b>كيف يشتغل؟</b>\n` +
      `1. اضغط <b>دعوة صديق</b> وانسخ رابطك الخاص\n` +
      `2. أرسل الرابط لصديقك\n` +
      `3. لما يسجل عبر رابطك ويشحن رصيد\n` +
      `4. تحصل أنت على <b>10%</b> من المبلغ تلقائياً\n\n` +
      `🔗 رابطك: <code>${inviteLink}</code>\n\n` +
      `💡 <i>العمولة تُضاف لرصيدك فور قبول الأدمن للشحن</i>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🎁 دعوة صديق", "invite_friend").row()
          .text("🔙 التعليمات", "help_menu").text("🏠 القائمة", "back_main"),
      }
    );
  });

  // ── حول البوت ───────────────────────────────────────────
  bot.callbackQuery("about_bot", async (ctx) => {
    ctx.answerCallbackQuery().catch(() => {});
    await ctx.reply(
      `🎮 <b>AutoGamer Bot</b>\n`+
      `دليل عمل البوت: أتمتة مهام iOS وتخطي تتبع AppsFlyer\n\n`+
      `هذا البوت مصمم خصيصاً لأتمتة وتخطي جدران العروض (Offerwalls) ومهام الـ CPE المعقدة على نظام iOS، من خلال استهداف آلية التتبع ونقاط الفحص داخل الألعاب المرتبطة بـ AppsFlyer SDK.\n\n`+
      `🔹 <b>كيف يعمل البوت؟</b>\n`+
      `• <b>محاكاة السلوك البشري:</b> تنفيذ الإجراءات داخل اللعبة (clicks, navigation, tutorials) بشكل أوتوماتيكي يحاكي حركة المستخدم الحقيقي لتفادي أنظمة كشف البوتات.\n`+
      `• <b>إرسال وتزوير أحداث التتبع:</b> التعامل مباشرة مع AppsFlyer SDK لإرسال إشارات إتمام المهام (In-App Events) مما يؤدي إلى تختيم المهمة فوراً في منصة العروض.\n`+
      `• <b>تخطي البصمة الرقمية:</b> تغيير المعرفات الأساسية (IDFA، device tokens، IP عبر بروكسيات) لضمان تكرار العمليات دون ربط الحسابات أو كشفها كحملات احتيالية.\n\n`+
      `🔹 <b>الفوائد التقنية:</b>\n`+
      `• توفير الوقت بالاستغناء الكامل عن اللعب اليدوي.\n`+
      `• رفع معدل التحويل (CR) وتحقيق نسبة نجاح عالية من الـ Offerwalls.\n`+
      `• إدارة متعددة الحسابات بالتوازي لمضاعفة العوائد.`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🏠 القائمة", "back_main"),
      }
    );
  });

  // /profile
  // /games — ألعابي
  bot.command("games", async (ctx) => {
    const user = ctx.from!;
    await upsertUser(user.id, user.username, user.first_name);
    await sendOrdersList(ctx, user.id);
  });

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
      // احسب السعر حسب عدد الليفلات
      const orderPrice = parseFloat((levels.length * PRICE_PER_LEVEL).toFixed(2));
      // تحقق من الرصيد قبل التأكيد
      const balance = await getUserBalance(user.id);
      if (balance < orderPrice) {
        delete sessions[user.id];
        return ctx.reply(
          `❌ <b>رصيدك غير كافٍ!</b>\n\n💵 رصيدك الحالي: <b>${balance.toFixed(2)}$</b>\n💰 سعر الطلب: <b>${orderPrice}$</b> (${levels.length} ليفل × ${PRICE_PER_LEVEL}$)\n\nاشحن رصيدك وحاول مجدداً.`,
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("💳 شحن رصيد", "show_topup").text("🏠 القائمة", "back_main") }
        );
      }
      // احفظ الليفلات وانتظر تأكيد
      session.step = "confirm";
      session.pendingLevels = levels;
      session.pendingPrice = orderPrice;
      return ctx.reply(
        `📋 <b>ملخص الطلب</b>\n\n` +
        `${session.gameEmoji} <b>${session.gameName}</b>\n` +
        `🎯 الليفلات: ${levels.join(", ")}\n` +
        `🔢 عدد الليفلات: <b>${levels.length}</b>\n` +
        `💰 السعر: <b>${orderPrice}$</b> (${levels.length} × ${PRICE_PER_LEVEL}$)\n` +
        `💵 رصيدك بعد الطلب: <b>${(balance - orderPrice).toFixed(2)}$</b>`,
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
      await notifyAdmin(
        `💳 <b>طلب شحن جديد #${reqId}</b>\n` +
        `👤 ${user.first_name}${user.username ? ` (@${user.username})` : ""}\n` +
        `💰 المبلغ: <b>${session.topupAmount}$</b>\n` +
        `📱 الطريقة: ${session.topupMethod === "syriatel" ? "سيريتيل كاش" : "USDT"}\n` +
        `🔢 رقم العملية: <code>${txId}</code>`
      );
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

    await notifyAdmin(
      `💳 <b>طلب شحن جديد #${reqId}</b>\n` +
      `👤 ${user.first_name}${user.username ? ` (@${user.username})` : ""}\n` +
      `💰 المبلغ: <b>${session.topupAmount}$</b>\n` +
      `📱 الطريقة: ${session.topupMethod === "syriatel" ? "سيريتيل كاش" : "USDT"}\n` +
      `📸 إثبات: صورة`
    );

    await ctx.reply(
      `✅ <b>تم استلام طلب الشحن بنجاح!</b>\n\n` +
      `💰 المبلغ: <b>${session.topupAmount}$</b>\n` +
      `🔢 رقم الطلب: <b>#${reqId}</b>\n\n` +
      `⏳ سيتم مراجعة طلبك وإضافة الرصيد في أقرب وقت ممكن 🙏`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 القائمة", "back_main") }
    );
  });

}

// ── قائمة الأوردرات (رسالة وحدة + زر لكل أوردر) ─────────────────────────
async function sendOrdersList(ctx: any, userId: number) {
  const orders = await getOrdersByUser(userId);

  if (!orders.length) {
    return ctx.reply("📋 ما عندك طلبات بعد.", {
      reply_markup: new InlineKeyboard()
        .text("🕹️ اطلب لعبة", "show_games")
        .text("🏠 القائمة", "back_main"),
    });
  }

  const keyboard = new InlineKeyboard();
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const statusIcon = o.status === "completed" ? "✅" : "⏳";
    keyboard.text(`${o.emoji} ${o.game_name} ${statusIcon}`, `order_detail_${o.id}`);
    keyboard.row();
  }
  keyboard.text("🏠 القائمة", "back_main");

  await ctx.reply(
    `🎮 <b>ألعابي (${orders.length})</b>\n\nاضغط على أي لعبة لتشوف تفاصيلها:`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}

// ── تفاصيل أوردر واحد ────────────────────────────────────────────────────
async function sendOrderDetail(ctx: any, orderId: number) {
  const [o, levels] = await Promise.all([
    getOrder(orderId),
    getOrderLevels(orderId),
  ]);

  if (!o) return ctx.reply("❌ الطلب غير موجود.");

  const doneCount = levels.filter(l => Number(l.stamped) === 1).length;
  const totalCount = levels.length;
  const statusIcon = o.status === "completed" ? "✅" : "⏳";

  const rows: string[] = [];
  for (let i = 0; i < levels.length; i += 5) {
    const chunk = levels.slice(i, i + 5);
    rows.push(
      chunk.map(l =>
        Number(l.stamped) === 1
          ? `✅ ${l.level}`
          : `🟡 ${l.level}`
      ).join("  │  ")
    );
  }

  await ctx.reply(
    `${o.emoji} <b>${o.game_name}</b> ${statusIcon}\n` +
    `📊 <b>${doneCount}/${totalCount}</b> مكتمل\n\n` +
    `${rows.join("\n")}`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🎮 ألعابي", "show_orders")
        .text("🏠 القائمة", "back_main"),
    }
  );
}

async function sendMainMenu(ctx: any, firstName: string) {
  const keyboard = new InlineKeyboard()
    .text("🎮 ألعابي", "show_orders").text("🕹️ اطلب لعبة", "show_games")
    .row()
    .text("💵 رصيدي", "show_balance").text("💳 شحن رصيد", "show_topup")
    .row()
    .text("🎁 دعوة صديق", "invite_friend")
    .row()
    .text("📖 تعليمات", "help_menu").text("ℹ️ حول", "about_bot")
    .row()
    .url("📢 قناتنا", "https://t.me/autogamerx").url("🆘 الدعم", `https://t.me/${SUPPORT_USERNAME}`);
  await ctx.reply(
    `🎮 <b>AutoGamer Bot</b>\n\n` +
    `البوت المتخصص في ختم جميع مراحل ومستويات ألعاب منصة Appsflyer ios حصرياً!\n\n` +
    `• ختم المراحل عن بعد: بدون أي تعب أو تضييع وقت.\n\n` +
    `• محاكاة بشرية 100%: أمان تام وتخطي ذكي للأنظمة.\n\n` +
    `• احتساب فوري: تنتهي المهمة وتحسب مكافأتك فوراً!\n\n` +
    `─────────────────────\n\n` +
    `👋 أهلاً ${firstName}، ابدأ واختر الآن! 👇`,
    { parse_mode: "HTML", reply_markup: keyboard }
  );
}
