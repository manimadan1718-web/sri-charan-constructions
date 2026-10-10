# 🏗️ Sri Charan Constructions – Site Log System

A full-stack web app for supervisors to log daily vehicle/machinery activity.

---

## 📁 Project Structure

```
sri-charan-constructions/
├── backend/
│   ├── config/
│   │   ├── supabase.js        ← Supabase client
│   │   └── setup-db.js        ← Prints SQL to create tables
│   ├── middleware/
│   │   └── auth.js            ← PIN-based auth
│   ├── routes/
│   │   ├── auth.js            ← POST /api/auth/login
│   │   ├── entries.js         ← CRUD for site entries
│   │   └── summaries.js       ← CRUD for manual summaries
│   └── server.js              ← Express server
├── frontend/
│   ├── css/style.css
│   ├── js/
│   │   ├── api.js             ← All fetch helpers
│   │   └── app.js             ← UI logic
│   ├── index.html             ← Main app
│   └── login.html             ← PIN login page
├── .env.example               ← Copy this to .env
├── .gitignore
└── package.json
```

---

## 🚀 Local Setup (Step by Step)

### 1. Install Node.js
Download from https://nodejs.org (LTS version)

### 2. Get your Supabase credentials
1. Go to https://supabase.com → Sign up (free)
2. Create a new project
3. Go to **Project Settings → API**
4. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role (secret) key** → `SUPABASE_SERVICE_KEY`  — the server uses ONLY this key.
     The public *anon* key is **not** needed anywhere, so do not put it in `.env` or on the host.

### 3. Create the database tables
```bash
npm run setup-db
```
Copy the SQL it prints → go to **Supabase → SQL Editor → New Query → paste → Run**

### 4. Configure environment
```bash
cp .env.example .env
```
Then edit `.env` and fill in your Supabase keys and set a PIN.

### 5. Install dependencies
```bash
npm install
```

### 6. Run the app
```bash
npm run dev       # development (auto-restarts on file changes)
# OR
npm start         # production
```

Open http://localhost:3000 in your browser.

---

## 🌐 Deploy to Production

### Option A — Render.com (Free & Easy)
1. Push this project to GitHub
2. Go to https://render.com → New Web Service
3. Connect your GitHub repo
4. Set **Build command**: `npm install`
5. Set **Start command**: `npm start`
6. Add your environment variables (from `.env`) in Render's dashboard
7. Deploy!

### Option B — Railway.app
1. Push to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variables
4. Railway auto-detects Node.js and deploys

### Option C — VPS (DigitalOcean / AWS)
```bash
# On your server:
git clone <your-repo>
cd sri-charan-constructions
npm install
cp .env.example .env   # fill in your values
npm install -g pm2
pm2 start backend/server.js --name scc
pm2 save
```

---

## 🔒 Security Notes

- Change `SUPERVISOR_PIN` (the first Admin's PIN) to something strong BEFORE running `npm run setup-db`,
  then change it again from the Users screen. Obvious PINs (1234, 0000, …) are refused by the app.
- `JWT_SECRET` must be a long random value (64+ characters). Generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `SUPABASE_SERVICE_KEY` must be the secret **service_role** key. The server warns at start-up if it looks like a public key.
- Never commit your `.env` file (it's in `.gitignore`). If a key was ever committed or shared, rotate it in Supabase.
- After deploying, run `run-in-supabase-2-database-security.sql` once so the database cannot be reached
  with the public key (see the file for the two checks to run afterwards).

---

## 📋 Features

- ✅ Daily vehicle/machinery log entry
- ✅ Work breakup rows (earthwork, levelling, etc.)
- ✅ Filter records by date or vehicle
- ✅ Auto-calculated summary stats (diesel, loads, vehicles)
- ✅ Manual summary entry by supervisor
- ✅ PIN-based login
- ✅ Print-friendly view
- ✅ Mobile responsive

---

## 🧾 Activity Logs (audit trail)

Every important action is recorded in the `activity_logs` table: logins (including failed and blocked
attempts), logouts, data-entry create / edit / delete, summaries, inventory and user changes.

- **Edits and deletes need a reason** (10+ characters). The popup shows exactly what changed; the server enforces the rule too.
- **Records → clock button** shows the full history of one entry (who, when, why, before → after).
- **Activity Logs tab** (Owner + Admin, read-only) lists everything, with filters and search.
- PINs are never written to the log. Log rows cannot be edited or deleted through the app.

**One-time setup:** run `run-in-supabase-logs.sql` in Supabase → SQL Editor. (`npm run setup-db` also prints it.)
