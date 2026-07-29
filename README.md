# Kunlik Reja Telegram Bot

Foydalanuvchilar kunlik rejalarini yozadi, har bir vazifani bajarganda ✅ belgilaydi. Admin (siz) barcha foydalanuvchilarni, ularning sonini va har kunlik statistikasini ko'ra olasiz.

## Imkoniyatlar

**Oddiy foydalanuvchi:**
- `/start` — botni boshlash, ro'yxatdan o'tish
- Istalgan vaqt matn yozsa (har qator = 1 vazifa) — bugungi rejaga qo'shiladi
- Har vazifa oldida tugma — bosilganda ✅/⬜ almashadi
- `/reja` — bugungi rejani qayta ko'rish

**Admin (siz):**
- `/admin` — panel: foydalanuvchilar soni, ro'yxati, har birining rejalari va statistikasi
- `/stats` — bugungi umumiy statistika (kim nechta vazifa qo'ygan, nechtasini bajargan)

Ma'lumotlar `data.db` nomli SQLite faylida saqlanadi (qo'shimcha bazaga ehtiyoj yo'q).

## 1-qadam: Bot yaratish

1. Telegram'da [@BotFather](https://t.me/BotFather) ga yozing
2. `/newbot` yuboring, nom va username bering
3. Sizga beriladigan **tokenni** saqlab qo'ying

## 2-qadam: O'z Telegram ID'ingizni bilish

1. [@userinfobot](https://t.me/userinfobot) ga `/start` yozing
2. U sizga ID raqamingizni beradi (masalan `123456789`)

## 3-qadam: Loyihani sozlash

```bash
npm install
cp .env.example .env
```

`.env` faylini oching va quyidagilarni to'ldiring:

```
BOT_TOKEN=BotFather_bergan_token
ADMIN_IDS=sizning_telegram_id_raqamingiz
```

Bir nechta admin bo'lsa: `ADMIN_IDS=111111111,222222222`

## 4-qadam: Ishga tushirish (lokal test uchun)

```bash
npm start
```

Terminalda "Bot ishga tushdi..." chiqsa — Telegram'da botga `/start` yozib sinab ko'rishingiz mumkin.

## 5-qadam: Doimiy ishlaydigan qilib joylashtirish (deploy)

Bot doimo ishlab turishi uchun uni serverga joylashtirish kerak. Eng oson yo'l — **Render.com**:

1. Loyihani GitHub'ga yuklang 
2. [render.com](https://render.com) da **New → Background Worker** tanlang (bot uchun Web Service emas, Background Worker mos, chunki bot HTTP so'rovlarni kutmaydi)
3. Sozlamalar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. **Environment** bo'limida `BOT_TOKEN` va `ADMIN_IDS` ni qo'shing
5. Deploy qiling

⚠️ **Muhim:** Render'ning bepul tarifida disk vaqtinchalik (ephemeral) — deploy qilinganda yoki qayta ishga tushganda `data.db` fayli o'chib ketishi mumkin. Ma'lumotlar doimiy saqlanishi uchun:
- Render'da **Persistent Disk** qo'shing (pullik reja, oyiga bir necha dollar), yoki
- Kelajakda kerak bo'lsa PostgreSQL kabi tashqi bazaga o'tkazish mumkin (aytsangiz shu variantni ham tayyorlab beraman)

Muqobil variantlar: Railway.app, Fly.io — ularda ham shu tarzda `npm install` / `npm start` bilan ishlaydi.

## Fayllar tuzilishi

```
daily-plan-bot/
├── bot.js          — botning asosiy mantiqi (buyruqlar, tugmalar)
├── db.js           — SQLite bilan ishlash funksiyalari
├── package.json
├── .env.example    — .env namunasi
└── data.db         — (avtomatik yaratiladi, foydalanuvchi va reja ma'lumotlari shu yerda)
```

## Kengaytirish g'oyalari

Agar kerak bo'lsa, keyinchalik qo'shish mumkin:
- Har kuni belgilangan vaqtda foydalanuvchilarga "Bugungi rejangizni yozing" eslatmasi (cron/`node-cron`)
- Haftalik/oylik statistika hisobotlari
- Vazifani o'chirish yoki tahrirlash imkoniyati
- Excel/CSV formatida statistika eksporti
