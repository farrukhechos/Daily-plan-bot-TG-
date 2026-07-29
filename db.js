const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE INDEX IF NOT EXISTS idx_plans_user_date ON plans(user_id, plan_date);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
`);

function getOrCreateUser(tgUser) {
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  if (existing) {
    // ism yoki username o'zgargan bo'lishi mumkin, yangilab qo'yamiz
    db.prepare('UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?')
      .run(tgUser.username || null, tgUser.first_name || null, tgUser.id);
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgUser.id);
  }
  const info = db.prepare(
    'INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)'
  ).run(tgUser.id, tgUser.username || null, tgUser.first_name || null);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function getUserByTelegramId(telegramId) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

function getOrCreatePlan(userId, dateStr) {
  const existing = db.prepare('SELECT * FROM plans WHERE user_id = ? AND plan_date = ?').get(userId, dateStr);
  if (existing) return existing;
  const info = db.prepare('INSERT INTO plans (user_id, plan_date) VALUES (?, ?)').run(userId, dateStr);
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(info.lastInsertRowid);
}

function addTask(planId, text) {
  const info = db.prepare('INSERT INTO tasks (plan_id, text) VALUES (?, ?)').run(planId, text);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
}

function getPlanTasks(planId) {
  return db.prepare('SELECT * FROM tasks WHERE plan_id = ? ORDER BY id ASC').all(planId);
}

function getTask(taskId) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

function toggleTask(taskId) {
  const task = getTask(taskId);
  if (!task) return null;
  const newVal = task.is_done ? 0 : 1;
  db.prepare('UPDATE tasks SET is_done = ? WHERE id = ?').run(newVal, taskId);
  return getTask(taskId);
}

function getPlanById(planId) {
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(planId);
}

function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function getUsersCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserPlans(userId) {
  return db.prepare('SELECT * FROM plans WHERE user_id = ? ORDER BY plan_date DESC').all(userId);
}

// Bitta userning bitta kundagi vazifalari + bajarilgan/jami soni
function getUserPlanDetail(userId, planDate) {
  const plan = db.prepare('SELECT * FROM plans WHERE user_id = ? AND plan_date = ?').get(userId, planDate);
  if (!plan) return null;
  const tasks = getPlanTasks(plan.id);
  const done = tasks.filter(t => t.is_done).length;
  return { plan, tasks, done, total: tasks.length };
}

// Bugungi kun uchun barcha foydalanuvchilar statistikasi (admin uchun)
function getTodayStats(dateStr) {
  const rows = db.prepare(`
    SELECT u.id as user_id, u.username, u.first_name,
           p.id as plan_id,
           COUNT(t.id) as total,
           SUM(CASE WHEN t.is_done = 1 THEN 1 ELSE 0 END) as done
    FROM users u
    LEFT JOIN plans p ON p.user_id = u.id AND p.plan_date = ?
    LEFT JOIN tasks t ON t.plan_id = p.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all(dateStr);
  return rows;
}

module.exports = {
  getOrCreateUser,
  getUserByTelegramId,
  getOrCreatePlan,
  addTask,
  getPlanTasks,
  getTask,
  toggleTask,
  getPlanById,
  getAllUsers,
  getUsersCount,
  getUserById,
  getUserPlans,
  getUserPlanDetail,
  getTodayStats,
};
