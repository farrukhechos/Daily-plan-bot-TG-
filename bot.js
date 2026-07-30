require('dotenv').config();
const path = require('path');
const cron = require('node-cron');
const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('XATO: .env faylida BOT_TOKEN topilmadi.');
  process.exit(1);
}

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);

const bot = new Telegraf(BOT_TOKEN);
bot.use(async (ctx, next) => {

  if (!ctx.from) return next();

  const user = db.getUserByTelegramId(ctx.from.id);

  if (user && user.is_banned) {

    try {
      await ctx.reply(
          "🚫 Siz administrator tomonidan ushbu botdan bloklandingiz."
      );
    } catch {}

    return;
  }

  return next();

});

// Har bir foydalanuvchining "hozir nima kutayapman" holati (xotirada, RAMda)
// masalan: { action: 'add' } yoki { action: 'edit', taskId: 12 }
const pendingAction = new Map();
const adminBroadcast = new Map();

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

// Matnni vazifalarga bo'lish: qator ham, vergul ham ajratuvchi hisoblanadi
function splitIntoTasks(text) {
  return text
      .split('\n')
      .flatMap((line) => line.split(','))
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
}

const REMINDER_OPTIONS = [
  { label: '15 daqiqa', minutes: 15 },
  { label: '30 daqiqa', minutes: 30 },
  { label: '1 soat', minutes: 60 },
  { label: '2 soat', minutes: 120 },
  { label: '3 soat', minutes: 180 },
  { label: "O'chirish", minutes: 0 },
];

// ---------- Asosiy menyu (pastdagi doimiy tugmalar) ----------

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['📋 Rejalarim'],
    ['🔔 Bildirishnoma sozlamalari'],
  ]).resize();
}

// ---------- Bugungi reja: boshqaruv ekrani ----------

function planText(dateStr, tasks) {
  const done = tasks.filter((t) => t.is_done).length;
  if (tasks.length === 0) {
    return `🗓 ${formatDate(dateStr)}\n\nHali vazifa qo'shilmagan.\nQuyidagi "➕ Yangi vazifa qo'shish" tugmasini bosing yoki shunchaki yozib yuboring.`;
  }
  return `🗓 ${formatDate(dateStr)} kunlik reja\nBajarildi: ${done}/${tasks.length}`;
}

function planManageKeyboard(tasks, { editable = true } = {}) {
  const rows = [];
  tasks.forEach((t) => {
    rows.push([
      Markup.button.callback(`${t.is_done ? '✅' : '⬜'} ${t.text}`, `toggle_${t.id}`),
    ]);
    if (editable) {
      rows.push([
        Markup.button.callback('✏️ Tahrirlash', `edit_${t.id}`),
        Markup.button.callback("🗑 O'chirish", `delete_${t.id}`),
      ]);
    }
  });
  if (editable) {
    rows.push([Markup.button.callback('➕ Yangi vazifa qo\'shish', 'add_task')]);
    rows.push([Markup.button.callback("🕘 Oldingi rejalarim", 'history_0')]);
  } else {
    rows.push([Markup.button.callback('⬅️ Ortga', 'history_0')]);
  }
  return Markup.inlineKeyboard(rows);
}

async function showTodayPlan(ctx, { edit = false } = {}) {
  const user = db.getOrCreateUser(ctx.from);
  const date = todayStr();
  const plan = db.getOrCreatePlan(user.id, date);
  const tasks = db.getPlanTasks(plan.id);
  const text = planText(date, tasks);
  const kb = planManageKeyboard(tasks, { editable: true });
  if (edit) {
    try {
      await ctx.editMessageText(text, kb);
      return;
    } catch (e) {
      // xabarni tahrirlab bo'lmasa, yangisini yuboramiz
    }
  }
  await ctx.reply(text, kb);
}

// ---------- Bot buyruqlari ----------

bot.start(async (ctx) => {
  db.getOrCreateUser(ctx.from);
  await ctx.reply(
      `Assalomu alaykum, ${ctx.from.first_name || "do'stim"}! 👋\n\n` +
      `Bu bot orqali kunlik rejangizni yozib, bajarganingizni belgilab borishingiz mumkin.\n\n` +
      `📌 Qanday ishlaydi:\n` +
      `• Vazifangizni yozib yuboring — har birini alohida qatorga yoki vergul bilan ajratib yozsangiz, har biri alohida vazifa bo'lib qo'shiladi.\n` +
      `• Har bir vazifani ✅ belgilash, ✏️ tahrirlash yoki 🗑 o'chirish mumkin.\n` +
      `• Bajarilmagan vazifalaringiz haqida siz belgilagan vaqt oralig'ida eslatma keladi.\n\n` +
      `Pastdagi menyudan foydalaning 👇`,
      mainMenuKeyboard()
  );
});

bot.hears('📋 Rejalarim', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await showTodayPlan(ctx);
});

bot.command('reja', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await showTodayPlan(ctx);
});

bot.hears('🔔 Bildirishnoma sozlamalari', async (ctx) => {
  const user = db.getOrCreateUser(ctx.from);
  const current = user.reminder_interval_minutes;
  const rows = REMINDER_OPTIONS.map((o) => [
    Markup.button.callback(
        `${o.minutes === current ? '✅ ' : ''}${o.label}`,
        `rem_${o.minutes}`
    ),
  ]);
  await ctx.reply(
      `🔔 Bildirishnoma sozlamalari\n\nBajarilmagan vazifalaringiz bo'lsa, tanlangan vaqt oralig'ida sizga eslatma yuboraman.\n\nHozirgi sozlama: ${
          current > 0 ? current + ' daqiqada bir marta' : "o'chirilgan"
      }`,
      Markup.inlineKeyboard(rows)
  );
});

// ---------- Callback tugmalar ----------

bot.action(/^rem_(\d+)$/, async (ctx) => {
  const minutes = Number(ctx.match[1]);
  const user = db.getOrCreateUser(ctx.from);
  db.setReminderInterval(user.id, minutes);
  const rows = REMINDER_OPTIONS.map((o) => [
    Markup.button.callback(`${o.minutes === minutes ? '✅ ' : ''}${o.label}`, `rem_${o.minutes}`),
  ]);
  await ctx.editMessageText(
      `🔔 Bildirishnoma sozlamalari\n\nHozirgi sozlama: ${
          minutes > 0 ? minutes + ' daqiqada bir marta' : "o'chirilgan"
      }`,
      Markup.inlineKeyboard(rows)
  );
  await ctx.answerCbQuery("Saqlandi ✅");
});

bot.action('add_task', async (ctx) => {
  pendingAction.set(ctx.from.id, { action: 'add' });
  await ctx.answerCbQuery();
  await ctx.reply(
      "Yangi vazifa(lar)ni yozing. Bir nechtasini vergul yoki alohida qator bilan ajratib yuborsangiz, har biri alohida vazifa bo'lib qo'shiladi."
  );
});

bot.action(/^toggle_(\d+)$/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  const task = db.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Vazifa topilmadi.');
  const plan = db.getPlanById(task.plan_id);
  const user = db.getUserById(plan.user_id);
  if (user.telegram_id !== ctx.from.id) return ctx.answerCbQuery('Bu sizning vazifangiz emas.');

  const updated = db.toggleTask(taskId);
  await showTodayPlan(ctx, { edit: true });
  await ctx.answerCbQuery(updated.is_done ? 'Bajarildi ✅' : 'Bekor qilindi');
});

bot.action(/^edit_(\d+)$/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  const task = db.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Vazifa topilmadi.');
  const plan = db.getPlanById(task.plan_id);
  const user = db.getUserById(plan.user_id);
  if (user.telegram_id !== ctx.from.id) return ctx.answerCbQuery('Bu sizning vazifangiz emas.');

  pendingAction.set(ctx.from.id, { action: 'edit', taskId });
  await ctx.answerCbQuery();
  await ctx.reply(`Vazifa uchun yangi matnni yozing:\n\nEski matn: "${task.text}"`);
});

bot.action(/^delete_(\d+)$/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  const task = db.getTask(taskId);
  if (!task) return ctx.answerCbQuery('Vazifa topilmadi.');
  const plan = db.getPlanById(task.plan_id);
  const user = db.getUserById(plan.user_id);
  if (user.telegram_id !== ctx.from.id) return ctx.answerCbQuery('Bu sizning vazifangiz emas.');

  db.deleteTask(taskId);
  await showTodayPlan(ctx, { edit: true });
  await ctx.answerCbQuery("O'chirildi 🗑");
});

// ---------- Oldingi rejalar tarixi ----------

const HISTORY_PAGE_SIZE = 6;

bot.action(/^history_(\d+)$/, async (ctx) => {
  const page = Number(ctx.match[1]);
  const user = db.getOrCreateUser(ctx.from);
  const allPlans = db.getUserPlans(user.id);
  const start = page * HISTORY_PAGE_SIZE;
  const pagePlans = allPlans.slice(start, start + HISTORY_PAGE_SIZE);

  const rows = pagePlans.map((p) => {
    const tasks = db.getPlanTasks(p.id);
    const done = tasks.filter((t) => t.is_done).length;
    return [Markup.button.callback(
        `${formatDate(p.plan_date)} — ${done}/${tasks.length}`,
        `histday_${p.plan_date}`
    )];
  });

  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Oldingi', `history_${page - 1}`));
  if (start + HISTORY_PAGE_SIZE < allPlans.length) navRow.push(Markup.button.callback('Keyingi ➡️', `history_${page + 1}`));
  if (navRow.length) rows.push(navRow);
  rows.push([Markup.button.callback("⬅️ Bugungi rejaga qaytish", 'back_today')]);

  const text = allPlans.length === 0
      ? "Hali hech qanday reja tarixi yo'q."
      : `🕘 Oldingi rejalaringiz (${allPlans.length} kun)\nKerakli kunni tanlang:`;

  try {
    await ctx.editMessageText(text, Markup.inlineKeyboard(rows));
  } catch (e) {
    await ctx.reply(text, Markup.inlineKeyboard(rows));
  }
  await ctx.answerCbQuery();
});

bot.action(/^histday_(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  const dateStr = ctx.match[1];
  const user = db.getOrCreateUser(ctx.from);
  const detail = db.getUserPlanDetail(user.id, dateStr);
  if (!detail) return ctx.answerCbQuery('Topilmadi');

  const isToday = dateStr === todayStr();
  const text = `🗓 ${formatDate(dateStr)}\nBajarildi: ${detail.done}/${detail.total}` +
      (isToday ? '' : '\n\n(bu — o\'tgan kun, faqat ko\'rish uchun)');

  await ctx.editMessageText(text, planManageKeyboard(detail.tasks, { editable: isToday }));
  await ctx.answerCbQuery();
});

bot.action('back_today', async (ctx) => {
  await showTodayPlan(ctx, { edit: true });
  await ctx.answerCbQuery();
});

// ---------- Matnli xabarlarni qayta ishlash ----------

bot.on('text', async (ctx, next) => {
  const raw = ctx.message.text;
  if (raw.length > 1000) {
    return ctx.reply(
        "❌ Juda uzun matn yubordingiz. Iltimos 1000 ta belgidan kamroq yuboring."
    );
  }
  if (adminBroadcast.get(ctx.from.id)) {
    adminBroadcast.delete(ctx.from.id);

    const users = db.getAllUsers();

    let sent = 0;
    let failed = 0;

    await ctx.reply(`📨 ${users.length} ta foydalanuvchiga yuborilmoqda...`);

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.telegram_id, raw);
        sent++;
      } catch (e) {
        failed++;
      }
    }

    return ctx.reply(
        `✅ Tugadi!\n\nYuborildi: ${sent}\nYuborilmadi: ${failed}`
    );
  }
  if (raw.startsWith('/')) return next();
  if (raw === '📋 Rejalarim' || raw === '🔔 Bildirishnoma sozlamalari') return next();

  const user = db.getOrCreateUser(ctx.from);
  const state = pendingAction.get(ctx.from.id);

  // Tahrirlash rejimida bo'lsa
  if (state && state.action === 'edit') {
    const newText = raw.trim();
    if (!newText) return ctx.reply("Matn bo'sh bo'lmasligi kerak.");
    db.updateTaskText(state.taskId, newText);
    pendingAction.delete(ctx.from.id);
    await ctx.reply('Vazifa yangilandi ✅');
    return showTodayPlan(ctx);
  }

  // Aks holda — yangi vazifa(lar) qo'shish (oddiy yozish yoki "➕" tugmasidan keyin ham shu yerga tushadi)
  pendingAction.delete(ctx.from.id);
  const items = splitIntoTasks(raw);
  if (items.length === 0) {
    return ctx.reply('Iltimos, kamida bitta vazifa yozing.');
  }

  const date = todayStr();
  const plan = db.getOrCreatePlan(user.id, date);
  items.forEach((text) => db.addTask(plan.id, text));

  await ctx.reply(`Qo'shildi ✅ (${items.length} ta yangi vazifa)`);
  await showTodayPlan(ctx);
});

// ---------- Admin qismi ----------

function adminGuard(ctx) {
  if (!isAdmin(ctx)) {
    ctx.reply('Bu buyruq faqat admin uchun.');
    return false;
  }
  return true;
}

bot.command('broadcast', async (ctx) => {
  if (!adminGuard(ctx)) return;

  adminBroadcast.set(ctx.from.id, true);

  await ctx.reply(
      "📢 Barcha foydalanuvchilarga yuboriladigan xabarni yozing."
  );
});
bot.command('admin', async (ctx) => {
  if (!adminGuard(ctx)) return;
  const count = db.getUsersCount();
  await ctx.reply(
      `🔐 Admin panel\n\nJami foydalanuvchilar: ${count}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("👥 Foydalanuvchilar ro'yxati", 'admin_users_0')],
        [Markup.button.callback('📊 Bugungi statistika', 'admin_stats_today')],
      ])
  );
});

bot.command('stats', async (ctx) => {
  if (!adminGuard(ctx)) return;
  await sendTodayStats(ctx);
});

async function sendTodayStats(ctx) {
  const date = todayStr();
  const rows = db.getTodayStats(date);
  const totalUsers = rows.length;
  const withPlan = rows.filter((r) => r.total && r.total > 0).length;
  const totalTasks = rows.reduce((s, r) => s + (r.total || 0), 0);
  const totalDone = rows.reduce((s, r) => s + (r.done || 0), 0);

  let msg = `📊 Bugungi statistika (${formatDate(date)})\n\n`;
  msg += `Jami foydalanuvchilar: ${totalUsers}\n`;
  msg += `Bugun reja kiritganlar: ${withPlan}\n`;
  msg += `Jami vazifalar: ${totalTasks}\n`;
  msg += `Bajarilgan vazifalar: ${totalDone}\n\n`;

  const active = rows.filter((r) => r.total && r.total > 0);
  if (active.length > 0) {
    msg += `Foydalanuvchilar bo'yicha:\n`;
    active.forEach((r) => {
      const name = r.username ? `@${r.username}` : (r.first_name || `ID:${r.user_id}`);
      msg += `• ${name}: ${r.done || 0}/${r.total}\n`;
    });
  }

  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(msg);
    await ctx.answerCbQuery();
  } else {
    await ctx.reply(msg);
  }
}

bot.action('admin_stats_today', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("Ruxsat yo'q");
  await sendTodayStats(ctx);
});

const ADMIN_PAGE_SIZE = 8;

bot.action(/^admin_users_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("Ruxsat yo'q");
  const page = Number(ctx.match[1]);
  const all = db.getAllUsers();
  const start = page * ADMIN_PAGE_SIZE;
  const pageUsers = all.slice(start, start + ADMIN_PAGE_SIZE);

  const rows = pageUsers.map((u) => {
    const label = u.username ? `@${u.username}` : (u.first_name || `ID:${u.telegram_id}`);
    return [Markup.button.callback(label, `admin_user_${u.id}`)];
  });

  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Oldingi', `admin_users_${page - 1}`));
  if (start + ADMIN_PAGE_SIZE < all.length) navRow.push(Markup.button.callback('Keyingi ➡️', `admin_users_${page + 1}`));
  if (navRow.length) rows.push(navRow);

  const text = `👥 Foydalanuvchilar (${all.length} ta)\nKerakli foydalanuvchini tanlang:`;
  try {
    await ctx.editMessageText(text, Markup.inlineKeyboard(rows));
  } catch (e) {
    await ctx.reply(text, Markup.inlineKeyboard(rows));
  }
  await ctx.answerCbQuery();
});

bot.action(/^admin_user_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("Ruxsat yo'q");
  const userId = Number(ctx.match[1]);
  const user = db.getUserById(userId);
  if (!user) return ctx.answerCbQuery('Topilmadi');

  const plans = db.getUserPlans(userId);
  const name = user.username ? `@${user.username}` : (user.first_name || `ID:${user.telegram_id}`);

  if (plans.length === 0) {
    await ctx.editMessageText(
        `👤 ${name}\nRo'yxatdan o'tgan, lekin hali reja kiritmagan.`,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Ortga', 'admin_users_0')]])
    );
    return ctx.answerCbQuery();
  }

  const rows = plans.slice(0, 15).map((p) => {
    const tasks = db.getPlanTasks(p.id);
    const done = tasks.filter((t) => t.is_done).length;
    return [Markup.button.callback(
        `${formatDate(p.plan_date)} — ${done}/${tasks.length}`,
        `admin_userplan_${userId}_${p.plan_date}`
    )];
  });
  rows.push([
    Markup.button.callback(
        user.is_banned ? "✅ Ban'dan chiqarish" : "🚫 Ban qilish",
        user.is_banned ? `unban_${userId}` : `ban_${userId}`
    )
  ]);

  rows.push([
    Markup.button.callback('⬅️ Ortga', 'admin_users_0')
  ]);

  await ctx.editMessageText(
      `👤 ${name}\nJami kunlar: ${plans.length}\nKunni tanlang:`,
      Markup.inlineKeyboard(rows)
  );
  await ctx.answerCbQuery();
});

bot.action(/^admin_userplan_(\d+)_(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("Ruxsat yo'q");
  const userId = Number(ctx.match[1]);
  const dateStr = ctx.match[2];
  const user = db.getUserById(userId);
  const detail = db.getUserPlanDetail(userId, dateStr);
  if (!user || !detail) return ctx.answerCbQuery('Topilmadi');

  const name = user.username ? `@${user.username}` : (user.first_name || `ID:${user.telegram_id}`);
  let msg = `👤 ${name}\n🗓 ${formatDate(dateStr)}\nBajarildi: ${detail.done}/${detail.total}\n\n`;
  detail.tasks.forEach((t) => {
    msg += `${t.is_done ? '✅' : '⬜'} ${t.text}\n`;
  });

  await ctx.editMessageText(
      msg,
      Markup.inlineKeyboard([[Markup.button.callback('⬅️ Ortga', `admin_user_${userId}`)]])
  );
  await ctx.answerCbQuery();
});

// ---------- Har daqiqada tekshiriladigan avtomatik eslatma ----------

cron.schedule('* * * * *', async () => {
  const date = todayStr();
  let dueUsers;
  try {
    dueUsers = db.getUsersDueForReminder(date);
  } catch (e) {
    console.error('Eslatmalarni tekshirishda xato:', e);
    return;
  }

  for (const user of dueUsers) {
    try {
      const tasks = db.getPlanTasks(user.plan_id);
      const undone = tasks.filter((t) => !t.is_done);
      if (undone.length === 0) continue;

      // eski eslatma xabarini o'chirib tashlaymiz (bo'lsa)
      if (user.last_reminder_chat_id && user.last_reminder_message_id) {
        try {
          await bot.telegram.deleteMessage(user.last_reminder_chat_id, user.last_reminder_message_id);
        } catch (e) {
          // eski xabar allaqachon o'chirilgan yoki muddati o'tgan bo'lishi mumkin — o'tkazib yuboramiz
        }
      }

      let text = `⏰ Eslatma: bugungi rejangizda hali bajarilmagan vazifalar bor:\n\n`;
      undone.forEach((t) => { text += `⬜ ${t.text}\n`; });

      const sent = await bot.telegram.sendMessage(
          user.telegram_id,
          text,
          planManageKeyboard(tasks, { editable: true })
      );

      db.setLastReminder(user.id, user.telegram_id, sent.message_id);
    } catch (e) {
      console.error(`Foydalanuvchi ${user.telegram_id} ga eslatma yuborishda xato:`, e.message);
    }
  }
});
bot.action(/^ban_(\d+)$/, async (ctx) => {

  if (!isAdmin(ctx)) return;

  const id = Number(ctx.match[1]);

  const user = db.getUserById(id);

  db.banUser(id);

  try {
    await bot.telegram.sendMessage(
        user.telegram_id,
        "🚫 Siz administrator tomonidan botdan bloklandingiz."
    );
  } catch {}

  await ctx.answerCbQuery("Ban qilindi");
});

bot.action(/^unban_(\d+)$/, async (ctx) => {

  if (!isAdmin(ctx)) return;

  const id = Number(ctx.match[1]);

  const user = db.getUserById(id);

  db.unbanUser(id);

  try {
    await bot.telegram.sendMessage(
        user.telegram_id,
        "✅ Sizning blokingiz olib tashlandi."
    );
  } catch {}

  await ctx.answerCbQuery("Ban olib tashlandi");
});

bot.launch();
console.log('Bot ishga tushdi...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));