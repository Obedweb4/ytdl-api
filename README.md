# OBED TECH — YouTube API v3.0

Self-hosted YouTube API with docs & playground frontend.
**No API key required** — scraping + `@distube/ytdl-core`.
**CommonJS** — deploys anywhere Node runs.

---

## Project Structure

```
yt-api/
├── backend/
│   ├── server.js        ← Express API (CommonJS, all routes)
│   ├── package.json
│   └── .env.example
├── frontend/
│   └── index.html       ← Docs & playground (served by backend)
├── start.sh             ← One-command local startup
├── vercel.json          ← Vercel deployment
├── Dockerfile           ← Docker
├── Procfile             ← Heroku
├── railway.toml         ← Railway
└── render.yaml          ← Render
```

---

## Quick Start

```bash
bash start.sh
```
Opens at **http://localhost:3000**

Or manually:
```bash
cd backend && npm install && npm start
```

---

## API Routes

| Route | Description |
|-------|-------------|
| `GET /api/health` | Server status |
| `GET /api/search` | Search videos & channels |
| `GET /api/video` | Video info, likes, comments count, share links, all formats |
| `GET /api/comments` | Video comments (author, text, likes, isPinned) |
| `GET /api/channel` | Channel info + recent videos |
| `GET /api/related` | Related / recommended videos |
| `GET /api/trending` | Trending videos by region |
| `GET /api/stream` | Stream video/audio inline |
| `GET /api/download` | Download video/audio as file |

---

## Parameters

### `/api/search`
| Param | Default | Notes |
|-------|---------|-------|
| `q` | **required** | Search query |
| `type` | `video` | `video` \| `channel` \| `all` |
| `order` | `relevance` | `relevance` \| `date` |
| `limit` | `20` | 1–50 |

### `/api/video`
| Param | Notes |
|-------|-------|
| `id` | **required** — 11-char video ID |

Returns: title, description, channel, views, **likes**, **commentCount**, published, keywords, **share** object (url, shortUrl, embed, embedCode), formats (combined/videoOnly/audioOnly)

### `/api/comments`
| Param | Default | Notes |
|-------|---------|-------|
| `id` | **required** | Video ID |
| `limit` | `20` | 1–50 |

Returns: commentCount, author, avatar, text, likes, published, isPinned, isOwner, replyCount

### `/api/channel`
| Param | Notes |
|-------|-------|
| `id` | Channel ID `UC...` |
| `handle` | e.g. `@MrBeast` |

Returns: name, handle, subscribers, verified, avatar, banner, recentVideos[]

### `/api/related`
| Param | Default | Notes |
|-------|---------|-------|
| `id` | **required** | Video ID |
| `limit` | `20` | 1–50 |

### `/api/trending`
| Param | Default | Notes |
|-------|---------|-------|
| `region` | `US` | 2-letter ISO code (e.g. `KE`) |
| `limit` | `20` | 1–50 |

### `/api/stream` & `/api/download`
| Param | Default | Notes |
|-------|---------|-------|
| `id` | **required** | Video ID |
| `format` | `mp4` | `mp4` \| `mp3` |
| `quality` | `highest` | `highest` \| `lowest` \| itag number |

---

## Deploy

### Vercel
```bash
npm i -g vercel && vercel
```

### Railway
```bash
railway up
```

### Render
Push to GitHub → connect repo → Render reads `render.yaml` automatically.

### Heroku
```bash
heroku create && git push heroku main
```

### Docker
```bash
docker build -t yt-api . && docker run -p 3000:3000 yt-api
```

### VPS / cPanel
```bash
cd backend && npm install && node server.js
```
Use PM2 for production: `pm2 start backend/server.js --name yt-api`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `ALLOWED_ORIGIN` | `*` | CORS origin |
| `RATE_LIMIT_MAX` | `100` | Requests per IP per minute |
| `RATE_LIMIT_WINDOW` | `60000` | Window ms |

---

*Built by OBED TECH*
