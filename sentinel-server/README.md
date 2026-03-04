# SENTINEL — Global Threat Monitor

## Deploy FREE in 2 minutes on Railway

### Option A: Railway (Recommended — easiest)
1. Go to **railway.app** → Sign up free with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Upload this folder to a GitHub repo first:
   - Go to github.com → New repository → name it `sentinel-tracker`
   - Upload all files in this folder
4. Connect that repo on Railway → Deploy
5. Railway gives you a free URL like `sentinel-tracker.up.railway.app`
6. **Done** — everything works!

### Option B: Render (Also free)
1. Go to **render.com** → Sign up free
2. New → Web Service → Connect GitHub repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Free plan → Deploy

### Option C: Run locally
```bash
npm install
node server.js
# Open http://localhost:3000
```

## What the server does

| Endpoint | Function |
|---|---|
| `GET /api/oref` | Israeli Red Alert (OREF) real-time rockets |
| `GET /api/planes` | OpenSky ADS-B aircraft tracking |
| `GET /api/news` | RSS news from Al Jazeera + BBC Arabic |
| `GET /api/streams` | Live TV stream list |
| `GET /proxy/stream?url=...` | HLS stream proxy (fixes CORS for TV) |
| `GET /` | The SENTINEL frontend |

## Features
- 🗺️ Real map (CartoDB Dark)
- 🚨 Real Israeli rocket alerts (OREF API)
- ✈️ Real aircraft tracking (OpenSky ADS-B)
- 📰 Real news ticker (Al Jazeera RSS)
- 📺 Live TV: Al Jazeera / Al Mamlakah / Sky News Arabia
- 🚀 Missile animation with photos
- 🤖 AI Intel briefing (Claude)
- 📱 Mobile + Desktop responsive
