/**
 * server.js
 * - Innertube 初期化は遅延 & 再試行（指数バックオフ）
 * - ytdl.getInfo にタイムアウト
 * - /api/search, /api/stream/:id, /api/yt-img?id=...
 * - rate limit, helmet, morgan, global error handler
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import ytdl from "@distube/ytdl-core";
import { Innertube } from "youtubei.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 5000;

const app = express();

// Middlewares
app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(morgan("combined"));

// Rate limit for API routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});
app.use("/api/", apiLimiter);

// Static files
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));

// ========== YouTube client init with retry/backoff ==========
let youtube = null;
let initPromise = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function initYoutube(retries = 3) {
  if (youtube) return youtube;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let attempt = 0;
    while (attempt < retries) {
      try {
        attempt++;
        console.log(`[YouTube] initializing (attempt ${attempt})`);
        youtube = await Innertube.create({
          lang: "ja",
          location: "JP",
          retrieve_player: true,
        });
        console.log("[YouTube] initialized");
        return youtube;
      } catch (err) {
        console.error(`[YouTube] init failed (attempt ${attempt}):`, err.message || err);
        youtube = null;
        if (attempt >= retries) throw err;
        // exponential backoff
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    return null;
  })();

  return initPromise;
}

// health
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    youtubeReady: !!youtube,
    time: new Date().toISOString(),
  });
});

// ========== UTIL: validate ID ==========
function isValidYouTubeId(id) {
  return typeof id === "string" && /^[\w-]{11}$/.test(id);
}

// ========== UTIL: ytdl.getInfo with timeout ==========
async function getInfoWithTimeout(url, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    ytdl
      .getInfo(url)
      .then((info) => {
        if (!settled) {
          settled = true;
          resolve(info);
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("ytdl.getInfo timeout"));
      }
    }, timeoutMs);
  });
}

// ========== API: search ==========
app.get("/api/search", async (req, res, next) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "検索ワードを指定してください" });

  try {
    // try to init youtube, but if init fails, surface 503
    await initYoutube().catch(() => {});
    if (!youtube) return res.status(503).json({ error: "検索サービス利用不可（YouTube初期化失敗）" });

    // youtubei.js search
    const result = await youtube.search(q, { type: "video", limit: 30 });
    const videos = (result.videos || []).map((v) => ({
      id: v.id,
      title: v.title?.text ?? v.title,
      thumbnail: v.thumbnails?.[0]?.url ?? null,
      thumbnails: v.thumbnails?.map((t) => t.url) ?? [],
      author: v.author?.name ?? null,
      views: v.view_count?.text ?? null,
      duration: v.duration?.text ?? null,
    }));

    res.json(videos);
  } catch (err) {
    console.error("[API][/api/search] error:", err && err.stack ? err.stack : err);
    next(err);
  }
});

// ========== API: stream URLs ==========
app.get("/api/stream/:id", async (req, res, next) => {
  const id = req.params.id;
  if (!isValidYouTubeId(id)) return res.status(400).json({ error: "無効な動画IDです" });

  try {
    const videoUrl = `https://www.youtube.com/watch?v=${id}`;
    const info = await getInfoWithTimeout(videoUrl, 8000);

    const formats = info.formats || [];

    // try to find muxed (video+audio) first, prefer higher resolution but keep size small
    const muxed = formats
      .filter((f) => f.hasVideo && f.hasAudio && f.container && (f.mimeType || true))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    // If no muxed found, provide adaptive: best video + best audio
    let adaptive = null;
    if (!muxed) {
      const bestVideo = formats
        .filter((f) => f.hasVideo && !f.hasAudio)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      const bestAudio = formats
        .filter((f) => f.hasAudio && !f.hasVideo)
        .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0];
      adaptive = {
        video: bestVideo ? { url: bestVideo.url, itag: bestVideo.itag, container: bestVideo.container } : null,
        audio: bestAudio ? { url: bestAudio.url, itag: bestAudio.itag, container: bestAudio.container } : null,
      };
    }

    // Build response minimal and safe
    const payload = {
      id,
      muxed: muxed ? { url: muxed.url, itag: muxed.itag, container: muxed.container, qualityLabel: muxed.qualityLabel ?? muxed.height } : null,
      adaptive,
    };

    // short cache header; these URLs typically expire quickly
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(payload);
  } catch (err) {
    console.error("[API][/api/stream/:id] error:", err && err.stack ? err.stack : err);
    // If ytdl fails (rate limit or network), return 502 with helpful message
    return res.status(502).json({ error: "ストリームURLの取得に失敗しました（タイムアウト／リトライ推奨）" });
  }
});

// ========== API: yt-img (thumbnail) ==========
app.get("/api/yt-img", async (req, res) => {
  const id = String(req.query.id || "");
  if (!isValidYouTubeId(id)) return res.status(400).json({ error: "無効な動画IDです" });

  const resolutions = ["maxresdefault", "sddefault", "hqdefault", "mqdefault", "default"];

  // HEAD-check each url with small timeout, redirect to the first that exists.
  for (const resName of resolutions) {
    try {
      const url = `https://i.ytimg.com/vi/${id}/${resName}.jpg`;
      // do HEAD with timeout using fetch & AbortController
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const resp = await fetch(url, { method: "HEAD", signal: controller.signal }).catch((e) => {
        clearTimeout(timeout);
        return null;
      });
      clearTimeout(timeout);
      if (resp && resp.ok) {
        return res.redirect(url);
      }
    } catch (e) {
      // ignore and continue
    }
  }
  res.status(404).json({ error: "サムネイルが見つかりません" });
});

// ========= SPA fallback =========
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ========= Error handler =========
app.use((err, req, res, next) => {
  console.error("[GLOBAL ERROR]", err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "サーバーでエラーが発生しました" });
});

// ========= process events =========
process.on("unhandledRejection", (r) => {
  console.error("[UNHANDLED REJECTION]", r);
});
process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
  // don't exit in Render environment; but in production you may wish to exit
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
