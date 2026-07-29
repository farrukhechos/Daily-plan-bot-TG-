require('dotenv').config();
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

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

function planKeyboard(tasks) {
  const rows = tasks.map((t) => [
    Markup.button.callback(
      `${t.is_done ? '✅' : '⬜'} ${t.text}`,
      `toggle_${t.id}`
    ),
  ]);
  return Markup.inlineKeyboard(rows);
}

function planText(dateStr, tasks) {
  const done = tasks.filter((t) => t.is_done).length;
  return `🗓 ${formatDate(dateStr)} kunlik reja\n` +
    `Bajarildi: ${done}/${tasks.length}\n\n` +
    `Vazifani bajargan bo'lsangiz, tugmani bosing 👇`;
}

// ---------- Foydalanuvchi buyruqlari ----------

bot.start(async (ctx) => {
  db.getOrCreateUser(ctx.from);
  await ctx.reply(
    `Assalomu alaykum, ${ctx.from.first_name || 'do\'stim'}! 👋\n\n` +
    `Bu bot orqali kunlik rejangizni yozib, bajarganingizni belgilab borishingiz mumkin.\n\n` +
    `📌 Qanday ishlaydi:\n` +
    `1. Menga bugungi rejangizni yozing, har bir vazifani yangi qatordan yozing. Masalan:\n\n` +
    `Ertalab yugurish\nKitob o'qish\nIngliz tili darsi\n\n` +
    `2. Men har bir vazifa uchun tugma bilan ro'yxat chiqarib beraman.\n` +
    `3. Vazifani bajarsangiz, shu tugmani bosing — u ✅ bo'lib qoladi.\n\n` +
    `Buyruqlar:\n` +
    `/reja — bugungi rejangizni qayta ko'rish`
  );
});

bot.command('reja', async (ctx) => {
  const user = db.getOrCreateUser(ctx.from);
  const date = todayStr();
  const detail = db.getUserPlanDetail(user.id, date);
  if (!detail || detail.tasks.length === 0) {
    return ctx.reply(
      "Bugun uchun hali reja kiritmagansiz.\nVazifalaringizni har birini yangi qatordan yozib yuboring."
    );
  }
  await ctx.reply(planText(date, detail.tasks), planKeyboard(detail.tasks));
});

// Oddiy matn xabar = yangi kunlik reja
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return next(); // buyruqlarni o'tkazib yuboramiz

  const user = db.getOrCreateUser(ctx.from);
  const date = todayStr();

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return ctx.reply('Iltimos, kamida bitta vazifa yozing.');
  }

  const plan = db.getOrCreatePlan(user.id, date);
  lines.forEach((line) => db.addTask(plan.id, line));

  const tasks = db.getPlanTasks(plan.id);
  await ctx.reply(
    `Reja saqlandi ✅ (${lines.length} ta yangi vazifa qo'shildi)\n\n` + planText(date, tasks),
    planKeyboard(tasks)
  );
});

// Checkbox bosilganda
bot.action(/^toggle_(\d+)$/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  const task = db.getTask(taskId);
  if (!task) {
    return ctx.answerCbQuery('Vazifa topilmadi.');
  }
  const plan = db.getPlanById(task.plan_id);
  const user = db.getUserById(plan.user_id);

  // Faqat vazifa egasi o'zgartira oladi
  if (user.telegram_id !== ctx.from.id) {
    return ctx.answerCbQuery('Bu sizning vazifangiz emas.');
  }

  const updated = db.toggleTask(taskId);
  const tasks = db.getPlanTasks(plan.id);
  await ctx.editMessageText(planText(plan.plan_date, tasks), planKeyboard(tasks));
  await ctx.answerCbQuery(updated.is_done ? 'Bajarildi ✅' : 'Bekor qilindi');
});

// ---------- Admin qismi ----------

function adminGuard(ctx) {
  if (!isAdmin(ctx)) {
    ctx.reply('Bu buyruq faqat admin uchun.');
    return false;
  }
  return true;
}

bot.command('admin', async (ctx) => {
  if (!adminGuard(ctx)) return;
  const count = db.getUsersCount();
  await ctx.reply(
    `🔐 Admin panel\n\nJami foydalanuvchilar: ${count}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('👥 Foydalanuvchilar ro\'yxati', 'admin_users_0')],
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
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ruxsat yo\'q');
  await sendTodayStats(ctx);
});

const PAGE_SIZE = 8;

bot.action(/^admin_users_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ruxsat yo\'q');
  const page = Number(ctx.match[1]);
  const all = db.getAllUsers();
  const start = page * PAGE_SIZE;
  const pageUsers = all.slice(start, start + PAGE_SIZE);

  const rows = pageUsers.map((u) => {
    const label = u.username ? `@${u.username}` : (u.first_name || `ID:${u.telegram_id}`);
    return [Markup.button.callback(label, `admin_user_${u.id}`)];
  });

  const navRow = [];
  if (page > 0) navRow.push(Markup.button.callback('⬅️ Oldingi', `admin_users_${page - 1}`));
  if (start + PAGE_SIZE < all.length) navRow.push(Markup.button.callback('Keyingi ➡️', `admin_users_${page + 1}`));
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
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ruxsat yo\'q');
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
  rows.push([Markup.button.callback('⬅️ Ortga', 'admin_users_0')]);

  await ctx.editMessageText(
    `👤 ${name}\nJami kunlar: ${plans.length}\nKunni tanlang:`,
    Markup.inlineKeyboard(rows)
  );
  await ctx.answerCbQuery();
});

bot.action(/^admin_userplan_(\d+)_(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Ruxsat yo\'q');
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

bot.launch();
console.log('Bot ishga tushdi...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
