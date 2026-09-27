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
   - **anon / public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_KEY`

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

- Change `SUPERVISOR_PIN` in `.env` to something strong before deploying
- Never commit your `.env` file (it's in `.gitignore`)
- For multi-user support, upgrade auth to JWT tokens

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
