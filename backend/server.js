/**
 * OBED TECH — YouTube API Server v3.0
 * CommonJS — runs on Node, Vercel, Railway, Render, Heroku, Replit, Docker, cPanel, VPS
 *
 * GET  /api/health
 * GET  /api/search     ?q= &type= &order= &limit=
 * GET  /api/video      ?id=
 * GET  /api/comments   ?id= &limit=
 * GET  /api/channel    ?id=  OR  ?handle=
 * GET  /api/related    ?id= &limit=
 * GET  /api/trending   ?region= &limit=
 * GET  /api/stream     ?id= &format= &quality=
 * GET  /api/download   ?id= &format= &quality=
 */

"use strict";

try { require("dotenv").config(); } catch (_) {}

const express = require("express");
const cors    = require("cors");
const ytdl    = require("@distube/ytdl-core");
const path    = require("path");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*", methods: ["GET"] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const rateLimitMap   = new Map();
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX    || "100");
const RATE_LIMIT_WIN = parseInt(process.env.RATE_LIMIT_WINDOW || "60000");

function rateLimit(req, res, next) {
  if (!req.originalUrl.startsWith("/api")) return next();
  const ip  = ((req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const rec = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - rec.start > RATE_LIMIT_WIN) { rec.count = 1; rec.start = now; } else rec.count++;
  rateLimitMap.set(ip, rec);
  if (rec.count > RATE_LIMIT_MAX)
    return res.status(429).json({ error: "Too many requests", retryIn: Math.ceil((rec.start + RATE_LIMIT_WIN - now) / 1000) + "s" });
  next();
}
app.use(rateLimit);

app.use((req, _res, next) => {
  if (req.originalUrl.startsWith("/api"))
    console.log(`[${new Date().toISOString()}]  ${req.method}  ${req.originalUrl}`);
  next();
});

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

const browserHeaders = () => ({
  "User-Agent":      USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
  "Accept-Language": "en-US,en;q=0.9",
  "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection":      "keep-alive",
});

async function fetchPage(url, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: browserHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}

const YT_BASE   = "https://www.youtube.com";
const YT_SEARCH = "https://www.youtube.com/results";

function extractYtInitialData(html) {
  let match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (match) { try { return JSON.parse(match[1]); } catch (_) {} }
  match = html.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});\s*(?:var |window\.|<\/script>)/);
  if (match) { try { return JSON.parse(match[1]); } catch (_) {} }
  throw new Error("Could not parse ytInitialData");
}

function safeGet(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return "";
    cur = cur[k];
  }
  return cur?.toString?.() ?? "";
}

function scrapeEngagement(html) {
  const out = { likes: null, commentCount: null };
  try {
    const likeMatch = html.match(/"label"\s*:\s*"([\d,]+)\s+likes"/) ||
                      html.match(/"accessibilityData"\s*:\s*\{"label"\s*:\s*"([\d,]+) likes"\}/);
    if (likeMatch) out.likes = likeMatch[1].replace(/,/g, "");
    const cmtMatch = html.match(/"commentCount"\s*:\s*\{"simpleText"\s*:\s*"([\d,]+)"\}/);
    if (cmtMatch) out.commentCount = cmtMatch[1].replace(/,/g, "");
  } catch (_) {}
  return out;
}

function parseSearchResults(data, type) {
  const items = [];
  try {
    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
    for (const section of sections) {
      for (const item of (section.itemSectionRenderer?.contents ?? [])) {
        if (item.videoRenderer && type !== "channel") {
          const v = item.videoRenderer;
          if (!v.videoId) continue;
          items.push({
            type: "video", id: v.videoId,
            title:       safeGet(v, "title", "runs", 0, "text"),
            channel:     safeGet(v, "ownerText", "runs", 0, "text"),
            channelId:   safeGet(v, "ownerText", "runs", 0, "navigationEndpoint", "browseEndpoint", "browseId"),
            thumbnail:   `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            duration:    safeGet(v, "lengthText", "simpleText"),
            views:       safeGet(v, "viewCountText", "simpleText"),
            published:   safeGet(v, "publishedTimeText", "simpleText"),
            description: safeGet(v, "detailedMetadataSnippets", 0, "snippetText", "runs", 0, "text"),
            url:         `https://www.youtube.com/watch?v=${v.videoId}`,
          });
        }
        if (item.channelRenderer && type !== "video") {
          const c = item.channelRenderer;
          if (!c.channelId) continue;
          items.push({
            type: "channel", id: c.channelId,
            name:        safeGet(c, "title", "simpleText"),
            handle:      safeGet(c, "customUrl"),
            subscribers: safeGet(c, "subscriberCountText", "simpleText"),
            videoCount:  safeGet(c, "videoCountText", "runs", 0, "text"),
            thumbnail:   safeGet(c, "thumbnail", "thumbnails", 0, "url"),
            description: safeGet(c, "descriptionSnippet", "runs", 0, "text"),
            url:         `https://www.youtube.com/channel/${c.channelId}`,
          });
        }
      }
    }
  } catch (_) {}
  return items;
}

function parseTrendingResults(data) {
  const items = [];
  try {
    for (const tab of (data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [])) {
      for (const section of (tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [])) {
        for (const item of (section?.itemSectionRenderer?.contents ?? [])) {
          const v = item?.videoWithContextRenderer ?? item?.videoRenderer;
          if (!v?.videoId) continue;
          items.push({
            id: v.videoId,
            title:     safeGet(v, "headline", "simpleText") || safeGet(v, "title", "runs", 0, "text") || safeGet(v, "title", "simpleText"),
            channel:   safeGet(v, "shortBylineText", "runs", 0, "text"),
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            views:     safeGet(v, "viewCountText", "simpleText"),
            published: safeGet(v, "publishedTimeText", "simpleText"),
            duration:  safeGet(v, "lengthText", "simpleText"),
            url:       `https://www.youtube.com/watch?v=${v.videoId}`,
          });
        }
      }
    }
  } catch (_) {}
  return items;
}

function parseComments(data) {
  const comments = [];
  try {
    const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents ?? [];
    for (const section of contents) {
      if (!section.itemSectionRenderer) continue;
      for (const ct of (section.itemSectionRenderer.contents ?? [])) {
        if (!ct.commentThreadRenderer) continue;
        const comment = ct.commentThreadRenderer?.comment?.commentRenderer;
        if (!comment) continue;
        comments.push({
          id:         safeGet(comment, "commentId"),
          author:     safeGet(comment, "authorText", "simpleText"),
          authorId:   safeGet(comment, "authorEndpoint", "browseEndpoint", "browseId"),
          avatar:     safeGet(comment, "authorThumbnail", "thumbnails", 0, "url"),
          text:       (comment.contentText?.runs ?? []).map(r => r.text || "").join(""),
          likes:      safeGet(comment, "voteCount", "simpleText") || "0",
          published:  safeGet(comment, "publishedTimeText", "runs", 0, "text"),
          isOwner:    !!comment.authorIsChannelOwner,
          isPinned:   !!ct.commentThreadRenderer.pinnedCommentBadge,
          replyCount: parseInt(safeGet(ct.commentThreadRenderer, "replyCount")) || 0,
        });
      }
    }
  } catch (_) {}
  return comments;
}

function parseChannelData(data) {
  try {
    const h = data?.header?.c4TabbedHeaderRenderer;
    if (!h) return null;
    return {
      id:          safeGet(h, "channelId"),
      name:        safeGet(h, "title"),
      handle:      safeGet(h, "channelHandleText", "runs", 0, "text"),
      subscribers: safeGet(h, "subscriberCountText", "simpleText") || safeGet(h, "subscriberCountText", "runs", 0, "text"),
      videosCount: safeGet(h, "videosCountText", "runs", 0, "text"),
      avatar:      safeGet(h, "avatar", "thumbnails", 0, "url"),
      banner:      safeGet(h, "banner", "thumbnails", 0, "url"),
      description: safeGet(h, "tagline", "channelTaglineRenderer", "content") || "",
      verified:    (h.badges ?? []).some(b => {
        const icon = safeGet(b, "metadataBadgeRenderer", "icon", "iconType");
        return icon === "CHECK_CIRCLE_THICK" || icon === "OFFICIAL_ARTIST_BADGE";
      }),
      badges: (h.badges ?? []).map(b => safeGet(b, "metadataBadgeRenderer", "tooltip")),
      url: `https://www.youtube.com/channel/${safeGet(h, "channelId")}`,
    };
  } catch (_) { return null; }
}

function parseRelatedVideos(data) {
  const items = [];
  try {
    const secondary = data?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results ?? [];
    for (const r of secondary) {
      const v = r.compactVideoRenderer;
      if (!v?.videoId) continue;
      items.push({
        id:        v.videoId,
        title:     safeGet(v, "title", "simpleText"),
        channel:   safeGet(v, "shortBylineText", "runs", 0, "text"),
        channelId: safeGet(v, "shortBylineText", "runs", 0, "navigationEndpoint", "browseEndpoint", "browseId"),
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        duration:  safeGet(v, "lengthText", "simpleText"),
        views:     safeGet(v, "viewCountText", "simpleText"),
        published: safeGet(v, "publishedTimeText", "simpleText"),
        url:       `https://www.youtube.com/watch?v=${v.videoId}`,
      });
    }
  } catch (_) {}
  return items;
}

const isValidVideoId   = id => typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id.trim());
const clampInt         = (val, min, max, def) => { const n = parseInt(val); return isNaN(n) ? def : Math.min(Math.max(n, min), max); };
const sendError        = (res, status, msg, details) => { if (!res.headersSent) res.status(status).json(Object.assign({ error: msg, status }, details ? { details } : {})); };
const sanitizeFilename = (name = "") => name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 100) || "video";
const formatDuration   = s => { if (!s || isNaN(s)) return "LIVE"; const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60, p = n => String(n).padStart(2,"0"); return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`; };
const buildYtdlOptions = (format, quality) => format === "mp3" ? { quality: "highestaudio", filter: "audioonly" } : quality === "lowest" ? { quality: "lowestvideo" } : !isNaN(parseInt(quality)) ? { quality: parseInt(quality) } : { quality: "highestvideo" };

// ════════════════ ROUTES ════════════════════════════════════════════════════

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok", server: "OBED TECH YT API v3.0",
    timestamp: new Date().toISOString(), uptime: `${Math.floor(process.uptime())}s`, node: process.version,
    routes: ["/api/health","/api/search","/api/video","/api/comments","/api/channel","/api/related","/api/trending","/api/stream","/api/download"],
  });
});

app.get("/api/search", async (req, res) => {
  const { q, type = "video", order = "relevance", limit = "20" } = req.query;
  if (!q?.trim()) return sendError(res, 400, "Missing required param: q");
  if (!["video","channel","all"].includes(type)) return sendError(res, 400, "type must be: video | channel | all");
  if (!["relevance","date"].includes(order)) return sendError(res, 400, "order must be: relevance | date");
  try {
    const params = new URLSearchParams({ search_query: q.trim() });
    if (order === "date") params.set("sp", "CAI%3D");
    const html  = await fetchPage(`${YT_SEARCH}?${params}`);
    const data  = extractYtInitialData(html);
    const items = parseSearchResults(data, type).slice(0, clampInt(limit, 1, 50, 20));
    res.json({ query: q.trim(), type, order, total: items.length, items });
  } catch (err) { console.error("[/api/search]", err.message); sendError(res, 500, "Search failed", err.message); }
});

app.get("/api/video", async (req, res) => {
  const { id } = req.query;
  if (!id) return sendError(res, 400, "Missing required param: id");
  if (!isValidVideoId(id)) return sendError(res, 400, "Invalid video ID (must be 11 chars)");
  try {
    const [info, html] = await Promise.all([
      ytdl.getInfo(id.trim()),
      fetchPage(`${YT_BASE}/watch?v=${id.trim()}`),
    ]);
    const vd = info.videoDetails;
    const engagement = scrapeEngagement(html);
    const formats = info.formats.map(f => ({
      itag: f.itag, quality: f.qualityLabel ?? f.quality ?? null, qualityLabel: f.qualityLabel ?? null,
      container: f.container, codecs: f.codecs, mimeType: f.mimeType,
      hasVideo: f.hasVideo, hasAudio: f.hasAudio, fps: f.fps ?? null,
      bitrate: f.bitrate ?? null, audioBitrate: f.audioBitrate ?? null,
      contentLength: f.contentLength ?? null, url: f.url,
    })).sort((a, b) => {
      const score = f => (f.hasVideo && f.hasAudio ? 0 : f.hasVideo ? 1 : 2) * 10000 - (parseInt(f.quality) || 0);
      return score(a) - score(b);
    });
    res.json({
      id: vd.videoId, title: vd.title,
      description: (vd.description || "").slice(0, 1000),
      channel: vd.author?.name ?? "", channelId: vd.channelId ?? "",
      channelUrl: vd.author?.channel_url ?? "",
      thumbnail: vd.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${vd.videoId}/maxresdefault.jpg`,
      thumbnails: vd.thumbnails ?? [],
      duration: vd.lengthSeconds, durationFormatted: formatDuration(parseInt(vd.lengthSeconds)),
      views: vd.viewCount,
      likes: engagement.likes ?? vd.likes ?? null,
      commentCount: engagement.commentCount ?? null,
      isLive: vd.isLiveContent ?? false,
      published: vd.publishDate ?? "", keywords: vd.keywords ?? [], category: vd.category ?? "",
      share: {
        url:       `https://youtu.be/${vd.videoId}`,
        watchUrl:  `https://www.youtube.com/watch?v=${vd.videoId}`,
        shortUrl:  `https://youtu.be/${vd.videoId}`,
        embed:     `https://www.youtube.com/embed/${vd.videoId}`,
        embedCode: `<iframe width="560" height="315" src="https://www.youtube.com/embed/${vd.videoId}" frameborder="0" allowfullscreen></iframe>`,
      },
      formats: {
        all:       formats,
        combined:  formats.filter(f => f.hasVideo && f.hasAudio),
        videoOnly: formats.filter(f => f.hasVideo && !f.hasAudio),
        audioOnly: formats.filter(f => !f.hasVideo && f.hasAudio),
      },
    });
  } catch (err) { console.error("[/api/video]", err.message); sendError(res, 500, "Could not fetch video info", err.message); }
});

app.get("/api/comments", async (req, res) => {
  const { id } = req.query;
  const limit = clampInt(req.query.limit, 1, 50, 20);
  if (!id) return sendError(res, 400, "Missing required param: id");
  if (!isValidVideoId(id)) return sendError(res, 400, "Invalid video ID");
  try {
    const html = await fetchPage(`${YT_BASE}/watch?v=${id.trim()}`);
    const data = extractYtInitialData(html);
    const engagement = scrapeEngagement(html);
    const comments = parseComments(data).slice(0, limit);
    res.json({
      videoId: id.trim(),
      commentCount: engagement.commentCount ?? null,
      total: comments.length,
      note: "First batch of comments from initial page load. YouTube lazy-loads more via continuation tokens.",
      comments,
    });
  } catch (err) { console.error("[/api/comments]", err.message); sendError(res, 500, "Could not fetch comments", err.message); }
});

app.get("/api/channel", async (req, res) => {
  const { id, handle } = req.query;
  if (!id && !handle) return sendError(res, 400, "Provide either ?id=UC... or ?handle=@name");
  try {
    const channelUrl = handle
      ? `${YT_BASE}/${handle.startsWith("@") ? handle : "@" + handle}`
      : `${YT_BASE}/channel/${id}`;

    const html    = await fetchPage(channelUrl);
    const data    = extractYtInitialData(html);
    const channel = parseChannelData(data);
    if (!channel) return sendError(res, 404, "Channel not found or could not be parsed");

    // Fetch recent videos tab
    let recentVideos = [];
    try {
      const vHtml = await fetchPage(channelUrl + "/videos");
      const vData = extractYtInitialData(vHtml);
      const tabs  = vData?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
      for (const tab of tabs) {
        if (!tab.tabRenderer?.selected) continue;
        for (const item of (tab.tabRenderer?.content?.richGridRenderer?.contents ?? [])) {
          const v = item.richItemRenderer?.content?.videoRenderer;
          if (!v?.videoId || recentVideos.length >= 12) continue;
          recentVideos.push({
            id: v.videoId, title: safeGet(v, "title", "runs", 0, "text"),
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            views: safeGet(v, "viewCountText", "simpleText"),
            published: safeGet(v, "publishedTimeText", "simpleText"),
            duration: safeGet(v, "lengthText", "simpleText"),
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
          });
        }
      }
    } catch (_) {}

    channel.recentVideos = recentVideos;
    res.json(channel);
  } catch (err) { console.error("[/api/channel]", err.message); sendError(res, 500, "Could not fetch channel info", err.message); }
});

app.get("/api/related", async (req, res) => {
  const { id } = req.query;
  const limit = clampInt(req.query.limit, 1, 50, 20);
  if (!id) return sendError(res, 400, "Missing required param: id");
  if (!isValidVideoId(id)) return sendError(res, 400, "Invalid video ID");
  try {
    const html  = await fetchPage(`${YT_BASE}/watch?v=${id.trim()}`);
    const data  = extractYtInitialData(html);
    const items = parseRelatedVideos(data).slice(0, limit);
    res.json({ videoId: id.trim(), total: items.length, items });
  } catch (err) { console.error("[/api/related]", err.message); sendError(res, 500, "Could not fetch related videos", err.message); }
});

app.get("/api/trending", async (req, res) => {
  const { region = "US" } = req.query;
  const limit = clampInt(req.query.limit, 1, 50, 20);
  if (!/^[A-Z]{2}$/i.test(region)) return sendError(res, 400, "region must be a 2-letter ISO code (e.g. US, KE, GB)");
  try {
    const html  = await fetchPage(`${YT_BASE}/feed/trending?bp=4gINGgt5dGQtdHJlbmRpbmcyAQ%3D%3D&gl=${region.toUpperCase()}&hl=en`);
    const data  = extractYtInitialData(html);
    const items = parseTrendingResults(data).slice(0, limit);
    res.json({ region: region.toUpperCase(), total: items.length, items });
  } catch (err) { console.error("[/api/trending]", err.message); sendError(res, 500, "Could not fetch trending", err.message); }
});

app.get("/api/stream", async (req, res) => {
  const { id, format = "mp4", quality = "highest" } = req.query;
  if (!id) return sendError(res, 400, "Missing required param: id");
  if (!isValidVideoId(id)) return sendError(res, 400, "Invalid video ID");
  if (!["mp4","mp3"].includes(format)) return sendError(res, 400, "format must be: mp4 | mp3");
  try {
    const info = await ytdl.getInfo(id.trim());
    const vd   = info.videoDetails;
    const ext  = format === "mp3" ? "mp3" : "mp4";
    res.setHeader("Content-Type",        format === "mp3" ? "audio/mpeg" : "video/mp4");
    res.setHeader("Content-Disposition", `inline; filename="${sanitizeFilename(vd.title)}.${ext}"`);
    res.setHeader("X-Video-Title",       encodeURIComponent(vd.title));
    res.setHeader("X-Video-Duration",    vd.lengthSeconds);
    res.setHeader("X-Powered-By",        "OBED-TECH-YT-API");
    const stream = ytdl(id.trim(), buildYtdlOptions(format, quality));
    stream.on("error", err => { console.error("[/api/stream]", err.message); if (!res.headersSent) sendError(res, 500, "Stream failed", err.message); else res.destroy(); });
    req.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch (err) { console.error("[/api/stream]", err.message); sendError(res, 500, "Could not start stream", err.message); }
});

app.get("/api/download", async (req, res) => {
  const { id, format = "mp4", quality = "highest" } = req.query;
  if (!id) return sendError(res, 400, "Missing required param: id");
  if (!isValidVideoId(id)) return sendError(res, 400, "Invalid video ID");
  if (!["mp4","mp3"].includes(format)) return sendError(res, 400, "format must be: mp4 | mp3");
  try {
    const info = await ytdl.getInfo(id.trim());
    const vd   = info.videoDetails;
    const ext  = format === "mp3" ? "mp3" : "mp4";
    res.setHeader("Content-Type",        format === "mp3" ? "audio/mpeg" : "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(vd.title)}.${ext}"`);
    res.setHeader("X-Video-Title",       encodeURIComponent(vd.title));
    res.setHeader("X-Video-Duration",    vd.lengthSeconds);
    res.setHeader("X-Powered-By",        "OBED-TECH-YT-API");
    const stream = ytdl(id.trim(), buildYtdlOptions(format, quality));
    stream.on("error", err => { console.error("[/api/download]", err.message); if (!res.headersSent) sendError(res, 500, "Download failed", err.message); else res.destroy(); });
    req.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch (err) { console.error("[/api/download]", err.message); sendError(res, 500, "Could not start download", err.message); }
});

app.use((req, res) => {
  if (req.originalUrl.startsWith("/api")) {
    return res.status(404).json({
      error: "Route not found", path: req.originalUrl,
      available: [
        "GET /api/health",
        "GET /api/search?q=<query>&type=video|channel|all&order=relevance|date&limit=1-50",
        "GET /api/video?id=<videoId>",
        "GET /api/comments?id=<videoId>&limit=20",
        "GET /api/channel?id=UC...  OR  ?handle=@name",
        "GET /api/related?id=<videoId>&limit=20",
        "GET /api/trending?region=KE&limit=20",
        "GET /api/stream?id=<videoId>&format=mp4|mp3&quality=highest|lowest",
        "GET /api/download?id=<videoId>&format=mp4|mp3&quality=highest|lowest",
      ],
    });
  }
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.listen(PORT, () => {
  console.log(`\n  OBED TECH YT API v3.0`);
  console.log(`  API:      http://localhost:${PORT}/api`);
  console.log(`  Frontend: http://localhost:${PORT}\n`);
});

module.exports = app;
