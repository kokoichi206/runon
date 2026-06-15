// Strava Bulk Uploader v2
// フォルダを1回選ぶと、中の .fit/.tcx/.gpx を /upload/files へ直接POSTして全件アップロードする。
// ページ遷移なし・IndexedDBへの全コピーなし。成功/重複したファイルは localStorage に控え、
// 再実行時は自動スキップする(タブを閉じてもフォルダを選び直せば続きから)。

(function stravaBulkUploaderV2() {
  "use strict";

  if (window.__sbu2Running) return;
  window.__sbu2Running = true;

  // ── 調整ポイント ─────────────────────────────────────────────
  const UPLOAD_URL = "/upload/files";
  const PROGRESS_URL = "/upload/progress.json";
  const ALLOWED = /\.(fit|tcx|gpx)(\.gz)?$/i;
  const BATCH_SIZE = 25; // 1リクエストに載せるファイル数(Strava上限25)
  const CONCURRENCY = 2; // 同時に走らせるバッチ数(多いほど429を誘発する)
  const POLL_INTERVAL = 2000; // 進捗ポーリング間隔(ms)
  const POLL_TIMEOUT = 180000; // 1ファイルの最大待機(ms)
  const POST_RETRY = 8; // 429/5xx 時の再試行回数(レート制限は待てば回復するので多め)
  const REQUEST_SPACING_MS = 400; // 全リクエスト共通の最小間隔(バースト抑制)
  const MAX_BACKOFF_MS = 60000; // 429 バックオフ上限
  const QUOTA_WAIT_MS = 10 * 60 * 1000; // アップロード上限を踏んだら待つ時間(自動再試行)
  // ───────────────────────────────────────────────────────────

  const DONE_KEY = "sbu2_done_v1"; // 成功/重複したファイル名の集合
  const POS_KEY = "sbu2_pos_v1";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const getToken = () => document.querySelector('meta[name="csrf-token"]')?.content;

  const escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );

  // ── 完了集合(localStorage) ──
  function getDone() {
    try {
      return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }
  function saveDone(set) {
    localStorage.setItem(DONE_KEY, JSON.stringify([...set]));
  }

  // ── 状態(メモリ) ──
  const state = {
    handles: [], // {name, handle}
    total: 0,
    results: [], // {name, status, error, activityId}
    counts: { success: 0, duplicate: 0, error: 0, timeout: 0, skipped: 0 },
    running: false,
    aborted: false,
    events: [],
  };

  function logEvent(msg) {
    state.events.push(msg);
    if (state.events.length > 200) state.events.shift();
    renderLog();
  }

  // ── UI ──
  function panel() {
    let el = document.getElementById("sbu2-panel");
    if (el) return el;
    el = document.createElement("div");
    el.id = "sbu2-panel";
    const pos = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    const place = pos ? `left:${pos.left}px;top:${pos.top}px;` : "right:16px;top:16px;";
    el.style.cssText =
      "position:fixed;" +
      place +
      "z-index:2147483647;width:320px;background:#fff;color:#222;border:1px solid #ddd;" +
      "border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.25);overflow:hidden;" +
      "font:13px/1.5 system-ui,sans-serif;";
    el.innerHTML =
      `<div id="sbu2-head" style="cursor:move;user-select:none;background:#fc4c02;color:#fff;` +
      `padding:8px 12px;font-weight:600">⠿ Strava Bulk Uploader v2</div>` +
      `<div id="sbu2-body" style="padding:12px 14px"></div>` +
      `<div id="sbu2-log" style="border-top:1px solid #eee;background:#fafafa;color:#555;` +
      `padding:8px 12px;max-height:150px;overflow:auto;font:11px/1.5 ui-monospace,monospace"></div>`;
    (document.body || document.documentElement).appendChild(el);
    makeDraggable(el, el.querySelector("#sbu2-head"));
    return el;
  }
  const body = () => {
    panel();
    return document.getElementById("sbu2-body");
  };
  function renderLog() {
    const box = document.getElementById("sbu2-log");
    if (!box) return;
    box.innerHTML = state.events
      .slice(-12)
      .map((m) => `<div>${escapeHtml(m)}</div>`)
      .join("");
    box.scrollTop = box.scrollHeight;
  }
  function makeDraggable(el, handle) {
    let on = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    handle.addEventListener("mousedown", (e) => {
      on = true;
      const r = el.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      el.style.right = "auto";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!on) return;
      el.style.left = Math.max(0, ox + e.clientX - sx) + "px";
      el.style.top = Math.max(0, oy + e.clientY - sy) + "px";
    });
    window.addEventListener("mouseup", () => {
      if (!on) return;
      on = false;
      const r = el.getBoundingClientRect();
      localStorage.setItem(
        POS_KEY,
        JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })
      );
    });
  }
  function bar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return (
      `<div style="background:#eee;border-radius:6px;height:8px;overflow:hidden;margin:8px 0">` +
      `<div style="background:#fc4c02;height:8px;width:${pct}%"></div></div>` +
      `<div style="font-size:12px;color:#666">${done} / ${total}（${pct}%）</div>`
    );
  }

  function renderStart(msg) {
    body().innerHTML =
      `<b>📁 一括アップロード</b>` +
      `<p style="color:#666">フォルダを選ぶと .fit/.tcx/.gpx を直接アップロードします。</p>` +
      (msg ? `<p style="color:#666;font-size:12px">${escapeHtml(msg)}</p>` : "") +
      `<button id="sbu2-pick" style="background:#fc4c02;color:#fff;border:none;border-radius:8px;` +
      `padding:10px 14px;cursor:pointer;font-size:13px">フォルダを選択して開始</button>` +
      (getDone().size
        ? ` <button id="sbu2-clear" style="margin-left:6px">完了履歴クリア</button>`
        : "");
    document.getElementById("sbu2-pick").onclick = pickAndRun;
    const clr = document.getElementById("sbu2-clear");
    if (clr)
      clr.onclick = () => {
        if (
          confirm(
            "「アップロード済み」の記録を消します。次回は全件を再送(重複はStravaが弾く)します。"
          )
        ) {
          localStorage.removeItem(DONE_KEY);
          renderStart("履歴をクリアしました");
        }
      };
  }

  function renderProgress() {
    const c = state.counts;
    const done = c.success + c.duplicate + c.error + c.timeout + c.skipped;
    body().innerHTML =
      `<b>🚀 アップロード中</b>` +
      bar(done, state.total) +
      `<div style="font-size:12px;color:#444;margin:6px 0">` +
      `成功 ${c.success}／重複 ${c.duplicate}／失敗 ${c.error}／時間切れ ${c.timeout}` +
      (c.skipped ? `／スキップ済 ${c.skipped}` : "") +
      `</div>` +
      `<button id="sbu2-stop">中断</button>`;
    const stop = document.getElementById("sbu2-stop");
    if (stop)
      stop.onclick = () => {
        state.aborted = true;
        logEvent("中断要求 — 進行中の本数が終わり次第停止します");
      };
  }

  function renderDone() {
    const c = state.counts;
    body().innerHTML =
      `<b>${state.aborted ? "⏹ 中断しました" : "🎉 完了"}</b>` +
      bar(c.success + c.duplicate + c.error + c.timeout + c.skipped, state.total) +
      `<div style="font-size:12px;color:#444;margin:6px 0">` +
      `成功 ${c.success}／重複 ${c.duplicate}／失敗 ${c.error}／時間切れ ${c.timeout}` +
      `</div>` +
      (c.error + c.timeout > 0
        ? `<p style="color:#b00;font-size:12px">失敗/時間切れぶんは「完了」未記録です。` +
          `同じフォルダでもう一度実行すると、未完了だけ再送します。</p>`
        : "") +
      `<button id="sbu2-dl" style="margin-right:6px">結果をDL</button>` +
      `<button id="sbu2-again">もう一度</button>`;
    document.getElementById("sbu2-dl").onclick = downloadResults;
    document.getElementById("sbu2-again").onclick = () => renderStart();
  }

  function downloadResults() {
    const lines = ["name\tstatus\tactivityId/error"];
    for (const r of state.results) {
      lines.push(`${r.name}\t${r.status}\t${r.activityId || r.error || ""}`);
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    a.download = "strava-upload-results.tsv";
    a.click();
  }

  // ── レート制御(全ワーカー共有) ──
  // 429 を受けたら Retry-After ぶん全員で待つ。全リクエストは最小間隔を空けてバーストを抑える。
  const gate = { until: 0, cool: 0, slot: 0 };
  let consec429 = 0;
  const isQuotaBody = (t) => /最大数|maximum number|too many|後ほど|try again later/i.test(t || "");
  async function pace() {
    const slot = Math.max(Date.now(), gate.slot);
    gate.slot = slot + REQUEST_SPACING_MS;
    // 長い待機(上限クールダウン)中も中断を拾えるよう小刻みに眠る。gate.until 延長にも追従。
    while (!state.aborted) {
      const target = Math.max(slot, gate.until);
      const wait = target - Date.now();
      if (wait <= 0) break;
      await sleep(Math.min(1000, wait));
    }
  }
  function note429(res) {
    const ra = parseInt(res.headers.get("retry-after") || "", 10);
    gate.cool = ra ? ra * 1000 : Math.min(MAX_BACKOFF_MS, Math.max(3000, gate.cool * 2 || 3000));
    gate.until = Math.max(gate.until, Date.now() + gate.cool);
    logEvent(`429 → 全体で ${Math.ceil((gate.until - Date.now()) / 1000)}s 待機`);
  }
  function noteOk() {
    gate.cool = Math.floor(gate.cool / 2); // 成功が続けば徐々に緩める
    consec429 = 0;
  }

  // アップロード上限を踏んだら、一定時間待って自動再試行する(中断で停止)。
  let waitTimer = null;
  function enterQuotaWait() {
    gate.until = Date.now() + QUOTA_WAIT_MS;
    const at = new Date(gate.until).toLocaleTimeString("ja-JP", { hour12: false });
    logEvent(`⛔ 上限到達 → 約${Math.round(QUOTA_WAIT_MS / 60000)}分待機して自動再開(${at}頃)`);
    renderWaiting(gate.until);
  }
  function renderWaiting(until) {
    if (waitTimer) clearInterval(waitTimer);
    const tick = () => {
      const left = Math.max(0, Math.round((until - Date.now()) / 1000));
      const c = state.counts;
      body().innerHTML =
        `<b>⏸ 上限のため待機中</b>` +
        bar(c.success + c.duplicate + c.error + c.timeout + c.skipped, state.total) +
        `<p style="color:#b00;font-size:12px">Strava の件数上限に達しました。約 ${Math.ceil(left / 60)} 分後に自動再開（残り ${left}s）。中断で止められます。</p>` +
        `<button id="sbu2-stop">中断</button>`;
      const stop = document.getElementById("sbu2-stop");
      if (stop)
        stop.onclick = () => {
          state.aborted = true;
          if (waitTimer) clearInterval(waitTimer);
          logEvent("中断");
        };
      if (left <= 0 && waitTimer) {
        clearInterval(waitTimer);
        waitTimer = null;
      }
    };
    tick();
    waitTimer = setInterval(tick, 1000);
  }

  // ── アップロード本体(バッチ) ──
  // 1リクエストに最大 BATCH_SIZE 件の files[] を載せる。応答 [{id, error}, ...] は
  // 送信順に返る前提。件数が合わなければ silent skip を避け、バッチごと失敗扱いにする。
  async function postBatch(files) {
    let attempt = 0; // 一時的な失敗(RA付き429/5xx)の回数。上限クォータでは消費しない。
    while (!state.aborted) {
      await pace();
      if (state.aborted) break;
      const fd = new FormData();
      fd.append("_method", "post");
      fd.append("authenticity_token", getToken());
      for (const f of files) fd.append("files[]", f, f.name);
      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        body: fd,
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (res.status === 429) {
        const txt = await res.text().catch(() => "");
        const hasRetryAfter = !!res.headers.get("retry-after");
        // Retry-After 無し＋上限メッセージ/連続429 = 件数クォータ。解けるまで待って自動再試行(枠は消費しない)。
        if (!hasRetryAfter && (isQuotaBody(txt) || ++consec429 >= 3)) {
          enterQuotaWait();
          continue;
        }
        note429(res); // RA付き等の一時スロットルは指数バックオフ＋回数上限
        if (++attempt >= POST_RETRY) throw new Error("429 が連続したため断念");
        continue;
      }
      if (res.status >= 500) {
        if (++attempt >= POST_RETRY) throw new Error(`HTTP ${res.status} が連続したため断念`);
        await sleep(3000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      noteOk();
      return res.json();
    }
    throw new Error("中断");
  }

  // 複数 id をまとめてポーリングし、各 id の終了状態を Map(id -> result) で返す。
  async function pollBatch(ids) {
    const out = new Map();
    const pending = new Set(ids);
    const deadline = Date.now() + POLL_TIMEOUT;
    while (pending.size && Date.now() < deadline && !state.aborted) {
      await sleep(POLL_INTERVAL);
      let arr;
      try {
        await pace();
        const q = [...pending].map((id) => `ids[]=${id}`).join("&");
        const res = await fetch(`${PROGRESS_URL}?${q}`, {
          credentials: "same-origin",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });
        if (res.status === 429) {
          note429(res);
          continue;
        }
        arr = await res.json();
      } catch {
        continue; // 一時的な失敗はポーリング継続
      }
      for (const p of Array.isArray(arr) ? arr : []) {
        if (!pending.has(p.id)) continue;
        let r = null;
        if (p.workflow === "success") r = { status: "success", activityId: p.activity?.id };
        else if (p.error)
          r = { status: /dup/i.test(p.error) ? "duplicate" : "error", error: p.error };
        else if (p.workflow === "error") r = { status: "error", error: "workflow error" };
        else if (p.workflow === "duplicate") r = { status: "duplicate" };
        if (r) {
          out.set(p.id, r);
          pending.delete(p.id);
        }
      }
    }
    for (const id of pending) out.set(id, { status: "timeout" });
    return out;
  }

  async function uploadBatch(entries) {
    const files = [];
    for (const e of entries) files.push(await e.handle.getFile());
    const arr = await postBatch(files);

    if (!Array.isArray(arr) || arr.length !== files.length) {
      // 想定外。位置対応が壊れるので、取りこぼし回避にバッチ全体を失敗扱いにして surface する。
      logEvent(
        `⚠️ 応答件数不一致(送${files.length}/受${Array.isArray(arr) ? arr.length : "?"})。このバッチは失敗扱い`
      );
      return entries.map((e) => ({ name: e.name, status: "error", error: "batch count mismatch" }));
    }

    // 送信順に id を割り当てる。即時 error(重複含む)はここで確定。
    const results = new Array(entries.length).fill(null);
    const idToIdx = new Map();
    arr.forEach((r, i) => {
      if (r && r.error) {
        results[i] = {
          name: entries[i].name,
          status: /dup/i.test(r.error) ? "duplicate" : "error",
          error: r.error,
        };
      } else if (!r || r.id == null) {
        results[i] = { name: entries[i].name, status: "error", error: "no id" };
      } else {
        idToIdx.set(r.id, i);
      }
    });

    if (idToIdx.size) {
      const progress = await pollBatch([...idToIdx.keys()]);
      for (const [id, i] of idToIdx) {
        results[i] = { name: entries[i].name, ...(progress.get(id) || { status: "timeout" }) };
      }
    }
    return results;
  }

  // ── バッチ実行プール ──
  async function runAll() {
    const done = getDone();
    const remaining = state.handles.filter((h) => !done.has(h.name));
    state.counts.skipped = state.handles.length - remaining.length;
    state.running = true;

    const batches = [];
    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      batches.push(remaining.slice(i, i + BATCH_SIZE));
    }
    logEvent(
      `開始: 全${state.handles.length}件 / 未完了${remaining.length}件(${batches.length}バッチ) / 既完了${state.counts.skipped}件`
    );

    let bi = 0;
    async function worker() {
      while (bi < batches.length && !state.aborted) {
        const batch = batches[bi++];
        let results;
        try {
          results = await uploadBatch(batch);
        } catch (e) {
          if (state.aborted) break; // 中断時は失敗計上せず停止(未doneなので次回再送)
          results = batch.map((en) => ({ name: en.name, status: "error", error: String(e) }));
        }
        for (const r of results) {
          state.results.push(r);
          state.counts[r.status] = (state.counts[r.status] || 0) + 1;
          if (r.status === "success" || r.status === "duplicate") done.add(r.name);
          logEvent(`${r.name}: ${r.status}${r.error ? " (" + r.error + ")" : ""}`);
        }
        saveDone(done); // バッチ単位で保存。タブが落ちても次回は未完了バッチから
        renderProgress();
      }
    }

    renderProgress();
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.running = false;
    logEvent(state.aborted ? "中断しました" : "完了");
    renderDone();
  }

  async function collect(dirHandle, acc) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file") {
        if (ALLOWED.test(entry.name)) acc.push({ name: entry.name, handle: entry });
      } else if (entry.kind === "directory") {
        await collect(entry, acc);
      }
    }
  }

  async function pickAndRun() {
    if (!getToken()) {
      renderStart("CSRFトークンが取得できません。/upload/select を開いて実行してください。");
      return;
    }
    let dir;
    try {
      dir = await window.showDirectoryPicker();
    } catch {
      return; // キャンセル
    }
    body().innerHTML = `<b>⏳ ファイルを探索中…</b>`;
    const acc = [];
    await collect(dir, acc);
    if (acc.length === 0) {
      renderStart("対象ファイル(.fit/.tcx/.gpx)が見つかりませんでした。");
      return;
    }
    acc.sort((a, b) => a.name.localeCompare(b.name));
    Object.assign(state, {
      handles: acc,
      total: acc.length,
      results: [],
      counts: { success: 0, duplicate: 0, error: 0, timeout: 0, skipped: 0 },
      aborted: false,
    });
    runAll();
  }

  renderStart();
})();
