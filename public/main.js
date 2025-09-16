const resultsDiv = document.getElementById("results");
const player = document.getElementById("player");
const titleEl = document.getElementById("videoTitle");
const statusEl = document.getElementById("status");
const toast = document.getElementById("toast");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const playerError = document.getElementById("playerError");

function showToast(msg, timeout = 3000) {
  toast.hidden = false;
  toast.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toast.hidden = true), timeout);
}

function setStatus(s) {
  statusEl.textContent = s;
}

function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(id));
}

searchBtn.addEventListener("click", onSearch);
searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") onSearch();
});

async function onSearch() {
  const q = (searchInput.value || "").trim();
  if (!q) return showToast("検索ワードを入力してください");
  resultsDiv.innerHTML = "検索中...";
  setStatus("検索中...");
  try {
    const res = await fetchWithTimeout(`/api/search?q=${encodeURIComponent(q)}`, {}, 10000);
    if (!res.ok) throw new Error(`検索失敗 (${res.status})`);
    const data = await res.json();
    renderResults(data);
    setStatus("検索完了");
  } catch (err) {
    console.error("search error", err);
    resultsDiv.innerHTML = "";
    showToast("検索中にエラーが発生しました");
    setStatus("エラー");
  }
}

function renderResults(items = []) {
  resultsDiv.innerHTML = "";
  if (!items.length) {
    resultsDiv.textContent = "結果が見つかりませんでした";
    return;
  }
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "result";
    const thumb = it.thumbnail || (it.thumbnails && it.thumbnails[0]) || "";
    card.innerHTML = `
      <img src="${thumb}" alt="">
      <div class="meta">
        <h4>${escapeHtml(it.title || "no title")}</h4>
        <p>${it.author || ""} • ${it.views || ""} • ${it.duration || ""}</p>
      </div>
    `;
    card.addEventListener("click", () => playVideo(it.id, it.title));
    resultsDiv.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

async function playVideo(id, title) {
  if (!id) return;
  titleEl.textContent = title || "";
  playerError.hidden = true;
  player.pause();
  player.removeAttribute("src");
  setStatus("ストリーム取得中...");
  try {
    const res = await fetchWithTimeout(`/api/stream/${id}`, {}, 10000);
    if (!res.ok) {
      const err = await safeJson(res);
      throw new Error(err?.error || `ストリーム取得失敗(${res.status})`);
    }
    const data = await res.json();
    const url = data.muxed?.url || data.adaptive?.video?.url || null;
    if (!url) throw new Error("再生可能なURLが見つかりません");
    // attach and play
    player.src = url;
    try {
      await player.play();
    } catch (e) {
      // autoplay may be blocked - user gesture required
      showToast("自動再生はブラウザでブロックされることがあります。再生ボタンを押してください。", 5000);
    }
    setStatus("再生中");
  } catch (err) {
    console.error("playVideo error", err);
    playerError.hidden = false;
    playerError.textContent = err.message || "再生に失敗しました";
    showToast("再生に失敗しました");
    setStatus("エラー");
  }
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// optional: warm up health
fetch("/api/health").then(() => {}).catch(() => {});
