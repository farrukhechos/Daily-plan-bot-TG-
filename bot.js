require('dotenv').config();
const path = require('path');
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
// masalan: { type: 'daily', action: 'add' } yoki { type: 'yearly', action: 'edit', taskId: 12 }
const pendingAction = new Map();
const adminBroadcast = new Map();

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function currentYear() {
  return new Date().getFullYear();
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

// ---------- Progress-bar / diagramma yordamchisi ----------

function progressBar(done, total, size = 12) {
  done = done || 0;
  total = total || 0;
  if (total === 0) return `${'░'.repeat(size)} 0%`;
  const ratio = Math.max(0, Math.min(1, done / total));
  const filled = Math.round(ratio * size);
  const pct = Math.round(ratio * 100);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${pct}%`;
}

const MONTH_NAMES_UZ = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

// ---------- Asosiy menyu (pastdagi doimiy tugmalar) ----------

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['📋 Kunlik reja', '📅 Yillik reja'],
    ['📊 Statistika'],
  ]).resize();
}

const MENU_LABELS = ['📋 Kunlik reja', '📅 Yillik reja', '📊 Statistika'];

// ---------- Bugungi reja: boshqaruv ekrani ----------

function planText(dateStr, tasks) {
  const done = tasks.filter((t) => t.is_done).length;
  if (tasks.length === 0) {
    return `🗓 ${formatDate(dateStr)}\n\nHali vazifa qo'shilmagan.\nQuyidagi "➕ Yangi vazifa qo'shish" tugmasini bosing yoki shunchaki yozib yuboring.`;
  }
  return `🗓 ${formatDate(dateStr)} — kunlik reja\n${progressBar(done, tasks.length)}\nBajarildi: ${done}/${tasks.length}`;
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

// ---------- Yillik reja: boshqaruv ekrani ----------

function yearlyPlanText(year, tasks) {
  const done = tasks.filter((t) => t.is_done).length;
  if (tasks.length === 0) {
    return `📅 ${year}-yil uchun yillik reja\n\nHali maqsad qo'shilmagan.\nQuyidagi "➕ Yangi maqsad qo'shish" tugmasini bosing yoki shunchaki yozib yuboring.`;
  }
  return `📅 ${year}-yil — yillik reja\n${progressBar(done, tasks.length)}\nBajarildi: ${done}/${tasks.length}`;
}

function yearlyManageKeyboard(tasks) {
  const rows = [];
  tasks.forEach((t) => {
    rows.push([
      Markup.button.callback(`${t.is_done ? '✅' : '⬜'} ${t.text}`, `ytoggle_${t.id}`),
    ]);
    rows.push([
      Markup.button.callback('✏️ Tahrirlash', `yedit_${t.id}`),
      Markup.button.callback("🗑 O'chirish", `ydelete_${t.id}`),
    ]);
  });
  rows.push([Markup.button.callback("➕ Yangi maqsad qo'shish", 'yadd_task')]);
  return Markup.inlineKeyboard(rows);
}

async function showYearlyPlan(ctx, { edit = false } = {}) {
  const user = db.getOrCreateUser(ctx.from);
  const year = currentYear();
  const plan = db.getOrCreateYearlyPlan(user.id, year);
  const tasks = db.getYearlyPlanTasks(plan.id);
  const text = yearlyPlanText(year, tasks);
  const kb = yearlyManageKeyboard(tasks);
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

// ---------- Statistika / diagrammalar ----------

function statsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📅 Bugungi kun', 'stats_today')],
    [Markup.button.callback('🗓 Shu oy (kunlar bo\'yicha)', 'stats_month')],
    [Markup.button.callback('📆 Shu yil (oylar bo\'yicha)', 'stats_year')],
    [Markup.button.callback('🎯 Yillik maqsadlar', 'stats_yearly_goals')],
  ]);
}

async function renderStats(ctx, text) {
  try {
    await ctx.editMessageText(text, statsMenuKeyboard());
  } catch (e) {
    await ctx.reply(text, statsMenuKeyboard());
  }
}

async function statsToday(ctx) {
  const user = db.getOrCreateUser(ctx.from);
  const date = todayStr();
  const plan = db.getOrCreatePlan(user.id, date);
  const tasks = db.getPlanTasks(plan.id);
  const done = tasks.filter((t) => t.is_done).length;
  const text =
      `📅 Bugungi kun statistikasi (${formatDate(date)})\n\n` +
      `${progressBar(done, tasks.length, 16)}\n` +
      `Bajarildi: ${done}/${tasks.length}`;
  await renderStats(ctx, text);
}

async function statsMonth(ctx) {
  const user = db.getOrCreateUser(ctx.from);
  const now = new Date();
  const ym = now.toISOString().slice(0, 7);
  const rows = db.getDailyStatsForMonth(user.id, ym);

  if (rows.length === 0) {
    await renderStats(ctx, `🗓 ${MONTH_NAMES_UZ[now.getMonth()]} oyi uchun hali reja kiritilmagan.`);
    return;
  }

  let totalTasks = 0;
  let totalDone = 0;
  let text = `🗓 ${MONTH_NAMES_UZ[now.getMonth()]} oyi — kunlar bo'yicha\n\n`;
  rows.forEach((r) => {
    const day = r.date.slice(8, 10);
    totalTasks += r.total || 0;
    totalDone += r.done || 0;
    text += `${day}-kun: ${progressBar(r.done, r.total, 8)} (${r.done || 0}/${r.total || 0})\n`;
  });
  text += `\nOylik jami: ${progressBar(totalDone, totalTasks, 16)}\n${totalDone}/${totalTasks} vazifa bajarildi`;
  await renderStats(ctx, text);
}

async function statsYear(ctx) {
  const user = db.getOrCreateUser(ctx.from);
  const year = currentYear();
  const rows = db.getMonthlyStatsForYear(user.id, year);

  if (rows.length === 0) {
    await renderStats(ctx, `📆 ${year}-yil uchun hali ma'lumot yo'q.`);
    return;
  }

  let totalTasks = 0;
  let totalDone = 0;
  let text = `📆 ${year}-yil — oylar bo'yicha\n\n`;
  rows.forEach((r) => {
    const idx = Number(r.month) - 1;
    const label = MONTH_NAMES_UZ[idx] ? MONTH_NAMES_UZ[idx].slice(0, 3) : r.month;
    totalTasks += r.total || 0;
    totalDone += r.done || 0;
    text += `${label}: ${progressBar(r.done, r.total, 8)} (${r.done || 0}/${r.total || 0})\n`;
  });
  text += `\nYillik jami: ${progressBar(totalDone, totalTasks, 16)}\n${totalDone}/${totalTasks} vazifa bajarildi`;
  await renderStats(ctx, text);
}

async function statsYearlyGoals(ctx) {
  const user = db.getOrCreateUser(ctx.from);
  const year = currentYear();
  const plan = db.getOrCreateYearlyPlan(user.id, year);
  const tasks = db.getYearlyPlanTasks(plan.id);
  const done = tasks.filter((t) => t.is_done).length;
  const text =
      `🎯 ${year}-yil yillik maqsadlar\n\n` +
      `${progressBar(done, tasks.length, 16)}\n` +
      `Bajarildi: ${done}/${tasks.length}`;
  await renderStats(ctx, text);
}

// ---------- Bot buyruqlari ----------

bot.start(async (ctx) => {
  db.getOrCreateUser(ctx.from);
  await ctx.reply(
      `Assalomu alaykum, ${ctx.from.first_name || "do'stim"}! 👋\n\n` +
      `Bu — professional reja boti. U bilan siz:\n\n` +
      `📋 Kunlik rejangizni yozib, bajarganingizni belgilashingiz;\n` +
      `📅 Yillik maqsadlaringizni belgilab, kuzatib borishingiz;\n` +
      `📊 Kunlik, oylik va yillik progressni diagramma ko'rinishida ko'rishingiz mumkin.\n\n` +
      `📌 Qanday ishlaydi:\n` +
      `• Vazifangizni yozib yuboring — har birini alohida qatorga yoki vergul bilan ajratib yozsangiz, har biri alohida vazifa bo'lib qo'shiladi.\n` +
      `• Har bir vazifani ✅ belgilash, ✏️ tahrirlash yoki 🗑 o'chirish mumkin.\n\n` +
      `Pastdagi menyudan foydalaning 👇`,
      mainMenuKeyboard()
  );
});

bot.hears('📋 Kunlik reja', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await showTodayPlan(ctx);
});

bot.command('reja', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await showTodayPlan(ctx);
});

bot.hears('📅 Yillik reja', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await showYearlyPlan(ctx);
});

bot.command('yillik', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await showYearlyPlan(ctx);
});

bot.hears('📊 Statistika', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await ctx.reply("📊 Qaysi statistikani ko'rmoqchisiz?", statsMenuKeyboard());
});

bot.command('stat', async (ctx) => {
  pendingAction.delete(ctx.from.id);
  await ctx.reply("📊 Qaysi statistikani ko'rmoqchisiz?", statsMenuKeyboard());
});

// ---------- Statistika callback tugmalari ----------

bot.action('stats_today', async (ctx) => {
  await statsToday(ctx);
  await ctx.answerCbQuery();
});

bot.action('stats_month', async (ctx) => {
  await statsMonth(ctx);
  await ctx.answerCbQuery();
});

bot.action('stats_year', async (ctx) => {
  await statsYear(ctx);
  await ctx.answerCbQuery();
});

bot.action('stats_yearly_goals', async (ctx) => {
  await statsYearlyGoals(ctx);
  await ctx.answerCbQuery();
});

// ---------- Kunlik reja: callback tugmalar ----------

bot.action('add_task', async (ctx) => {
  pendingAction.set(ctx.from.id, { type: 'daily', action: 'add' });
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

  pendingAction.set(ctx.from.id, { type: 'daily', action: 'edit', taskId });
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

// ---------- Yillik reja: callback tugmalar ----------

bot.action('yadd_task', async (ctx) => {
  pendingAction.set(ctx.from.id, { type: 'yearly', action: 'add' });
  await ctx.answerCbQuery();
  await ctx.reply(
      "Yangi yillik maqsad(lar)ni yozing. Bir nechtasini vergul yoki alohida qator bilan ajratib yuborsangiz, har biri alohida maqsad bo'lib qo'shiladi."
  );
});

bot.action(/^ytoggle_(\d+)$/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  const task = db.getYearlyTask(taskId);
  if (!task) return ctx.answerCbQuery('Maqsad topilmadi.');
  const plan = db.getYearlyPlanById(task.yearly_plan_id);
  const user = db.getUserById(plan.user_id);
  if (user.telegram_id !== ctx.from.id) return ctx.answerCbQuery('Bu sizning maqsadingiz emas.');

  const updated = db.toggleYearlyTask(taskId);
  await showYearlyPlan(ctx, { edit: true });
  await ctx.answerCbQuery(updated.is_done ? 'Bajarildi ✅' : 'Bekor qilindi');
});

bot.action(/^yedit_(\d+)$/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  const task = db.getYearlyTask(taskId);
  if (!task) return ctx.answerCbQuery('Maqsad topilmadi.');
  const plan = db.getYearlyPlanById(task.yearly_plan_id);
  const user = db.getUserById(plan.user_id);
  if (user.telegram_id !== ctx.from.id) return ctx.answerCbQuery('Bu sizning maqsadingiz emas.');

  pendingAction.set(ctx.from.id, { type: 'yearly', action: 'edit', taskId });
  await ctx.answerCbQuery();
  await ctx.reply(`Maqsad uchun yangi matnni yozing:\n\nEski matn: "${task.text}"`);
});

bot.action(/^ydelete_(\d+)$/, async (ctx) => {
  const taskId = Number(ctx.match[1]);
  const task = db.getYearlyTask(taskId);
  if (!task) return ctx.answerCbQuery('Maqsad topilmadi.');
  const plan = db.getYearlyPlanById(task.yearly_plan_id);
  const user = db.getUserById(plan.user_id);
  if (user.telegram_id !== ctx.from.id) return ctx.answerCbQuery('Bu sizning maqsadingiz emas.');

  db.deleteYearlyTask(taskId);
  await showYearlyPlan(ctx, { edit: true });
  await ctx.answerCbQuery("O'chirildi 🗑");
});

// ---------- Oldingi rejalar tarixi (kunlik) ----------

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
  if (raw.length > 200) {
    return ctx.reply(
        "❌ Juda uzun matn yubordingiz. Iltimos 200 ta belgidan kamroq yuboring."
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
  if (MENU_LABELS.includes(raw)) return next();

  const user = db.getOrCreateUser(ctx.from);
  const state = pendingAction.get(ctx.from.id);

  // Yillik reja rejimida bo'lsa
  if (state && state.type === 'yearly') {
    if (state.action === 'edit') {
      const newText = raw.trim();
      if (!newText) return ctx.reply("Matn bo'sh bo'lmasligi kerak.");
      db.updateYearlyTaskText(state.taskId, newText);
      pendingAction.delete(ctx.from.id);
      await ctx.reply('Maqsad yangilandi ✅');
      return showYearlyPlan(ctx);
    }

    // yangi yillik maqsad(lar) qo'shish
    pendingAction.delete(ctx.from.id);
    const items = splitIntoTasks(raw);
    if (items.length === 0) {
      return ctx.reply('Iltimos, kamida bitta maqsad yozing.');
    }
    const year = currentYear();
    const plan = db.getOrCreateYearlyPlan(user.id, year);
    items.forEach((text) => db.addYearlyTask(plan.id, text));

    await ctx.reply(`Qo'shildi ✅ (${items.length} ta yangi maqsad)`);
    return showYearlyPlan(ctx);
  }

  // Kunlik reja — tahrirlash rejimida bo'lsa
  if (state && state.action === 'edit') {
    const newText = raw.trim();
    if (!newText) return ctx.reply("Matn bo'sh bo'lmasligi kerak.");
    db.updateTaskText(state.taskId, newText);
    pendingAction.delete(ctx.from.id);
    await ctx.reply('Vazifa yangilandi ✅');
    return showTodayPlan(ctx);
  }

  // Aks holda — yangi kunlik vazifa(lar) qo'shish (oddiy yozish yoki "➕" tugmasidan keyin ham shu yerga tushadi)
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
  msg += `Bajarilgan vazifalar: ${totalDone}\n`;
  msg += `${progressBar(totalDone, totalTasks, 16)}\n\n`;

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