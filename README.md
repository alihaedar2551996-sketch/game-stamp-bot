# 🎮 بوت تختيم المراحل

بوت تيليغرام — الأدمن يختم مراحل المستخدمين من داشبورد، وكل تختيم يوصل إشعار فوري.

## خطوات الـ Deploy

### 1. GitHub
```bash
git init
git add .
git commit -m "🎮 Initial commit"
git remote add origin https://github.com/USERNAME/game-stamp-bot.git
git push -u origin main
```

### 2. Render.com
1. render.com → New → Web Service
2. Connect GitHub repo
3. أضف Environment Variables:
   - `BOT_TOKEN` — من @BotFather
   - `TURSO_URL` — libsql://auto-gamers-username.turso.io
   - `TURSO_TOKEN` — من turso.tech
   - `ADMIN_API_KEY` — كلمة سر الداشبورد
   - `WEBHOOK_URL` — رابط Render بعد الـ deploy (أضفه بعد أول deploy)
4. Build Command: `npm install -g bun && cd bot && bun install`
5. Start Command: `cd bot && bun src/index.ts`

### 3. بعد أول Deploy
- انسخ رابط Render (مثل: https://game-stamp-bot.onrender.com)
- أضفه كـ WEBHOOK_URL في Environment Variables
- الداشبورد: https://game-stamp-bot.onrender.com/dashboard

### 4. Keep-Alive (مهم!)
- cron-job.org → كل 10 دقائق → https://your-app.onrender.com/health

## أوامر البوت
- `/start` — تسجيل
- `/games` — عرض التقدم
- `/profile` — الملخص

## الداشبورد
`https://your-app.onrender.com/dashboard` + ADMIN_API_KEY
