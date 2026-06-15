// Strava 一括アップロード(本番)。tokens.json のトークンで /api/v3/uploads に投げ、
// ポーリングで成否確定。レート制限を尊重し、done.json で再開、results.csv に記録する。
// 依存なし(Node18+)。実行: node tools/strava-api-uploader/upload.mjs <dir>
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, basename } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const secrets = JSON.parse(readFileSync(here + "secrets.json", "utf8"));
const tokensPath = here + "tokens.json";
const donePath = here + "done.json";
const csvPath = here + "results.csv";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node upload.mjs <dir>");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dataType(name) {
  const n = name.toLowerCase();
  if (n.endsWith(".fit.gz")) return "fit.gz";
  if (n.endsWith(".tcx.gz")) return "tcx.gz";
  if (n.endsWith(".gpx.gz")) return "gpx.gz";
  if (n.endsWith(".fit")) return "fit";
  if (n.endsWith(".tcx")) return "tcx";
  if (n.endsWith(".gpx")) return "gpx";
  return null;
}

function collect(d, acc) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) collect(p, acc);
    else if (dataType(e.name)) acc.push(p);
  }
}

// ── トークン(期限切れなら refresh) ──
async function accessToken() {
  let t = JSON.parse(readFileSync(tokensPath, "utf8"));
  if (t.expires_at && t.expires_at * 1000 > Date.now() + 120000) return t.access_token;
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: secrets.client_id,
      client_secret: secrets.client_secret,
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
    }),
  });
  const nt = await r.json();
  if (!nt.access_token) throw new Error("token refresh 失敗: " + JSON.stringify(nt));
  t = { ...t, ...nt };
  writeFileSync(tokensPath, JSON.stringify(t, null, 2));
  console.log("トークンを更新しました");
  return t.access_token;
}

// ── レート制限(プロアクティブ順守) ──
// 公式: 全体 200/15分・2000/日(X-RateLimit-*), 読み取り(非アップロード) 100/15分・1000/日(X-ReadRateLimit-*)。
// ヘッダ "15分,日" を毎回読み、上限に達する前に枠リセットまで待つ。POSTは全体枠、GET pollは全体+読み取り枠を消費。
function msToNext15min() {
  const now = new Date();
  const next = (Math.floor(now.getUTCMinutes() / 15) + 1) * 15;
  const t = new Date(now);
  t.setUTCMinutes(next, 1, 0); // 1秒だけ余裕
  return t - now;
}
function msToNextUtcMidnight() {
  const now = new Date();
  const t = new Date(now);
  t.setUTCHours(24, 0, 30, 0);
  return t - now;
}
const MARGIN = 2; // 余裕(誤差・並びぶん)
const limits = {
  overall: { used: [0, 0], lim: [200, 2000] }, // POST/GET すべて
  read: { used: [0, 0], lim: [100, 1000] }, // 非アップロード(GET poll)のみ
};
function updateLimits(res) {
  const parse = (h) => (h ? h.split(",").map(Number) : null);
  const ou = parse(res.headers.get("x-ratelimit-usage"));
  const ol = parse(res.headers.get("x-ratelimit-limit"));
  const ru = parse(res.headers.get("x-readratelimit-usage"));
  const rl = parse(res.headers.get("x-readratelimit-limit"));
  if (ou) limits.overall.used = ou;
  if (ol) limits.overall.lim = ol;
  if (ru) limits.read.used = ru;
  if (rl) limits.read.lim = rl;
}
// 次のリクエストが枠を超えそうなら、リセットまで先回りで待つ。isRead=true は読み取り枠もチェック。
async function waitForBudget(isRead) {
  for (;;) {
    const buckets = isRead ? [limits.overall, limits.read] : [limits.overall];
    let wait = 0;
    let day = false;
    for (const b of buckets) {
      if (b.used[1] >= b.lim[1] - MARGIN) {
        wait = Math.max(wait, msToNextUtcMidnight());
        day = true;
      } else if (b.used[0] >= b.lim[0] - MARGIN) {
        wait = Math.max(wait, msToNext15min());
      }
    }
    if (wait <= 0) return;
    console.log(
      `枠保護: ${day ? "日枠" : "15分枠"}リセットまで約 ${Math.ceil(wait / 60000)} 分待機`
    );
    await sleep(wait);
    if (day) {
      limits.overall.used = [0, 0];
      limits.read.used = [0, 0];
    } else {
      limits.overall.used[0] = 0;
      limits.read.used[0] = 0;
    }
  }
}
// 保険: 万一 429 を踏んだら枠リセットまで待つ(基本は waitForBudget で踏まない)。
async function handle429(res) {
  updateLimits(res);
  const day =
    limits.overall.used[1] >= limits.overall.lim[1] || limits.read.used[1] >= limits.read.lim[1];
  const wait = day ? msToNextUtcMidnight() : msToNext15min();
  console.log(`429 → ${day ? "日枠" : "15分枠"}リセットまで約 ${Math.ceil(wait / 60000)} 分待機`);
  await sleep(wait);
  if (day) {
    limits.overall.used = [0, 0];
    limits.read.used = [0, 0];
  } else {
    limits.overall.used[0] = 0;
    limits.read.used[0] = 0;
  }
}

async function postUpload(token, path) {
  await waitForBudget(false); // 全体枠を先回りで確保
  const name = basename(path);
  const fd = new FormData();
  fd.append("data_type", dataType(name));
  fd.append("external_id", name);
  fd.append("file", new Blob([readFileSync(path)]), name);
  const res = await fetch("https://www.strava.com/api/v3/uploads", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  updateLimits(res);
  return res;
}

async function pollUpload(token, id) {
  // 読み取り枠(1000/日)節約のため最大6回まで。処理は通常数秒で終わる。
  for (let i = 0; i < 6; i++) {
    await sleep(i === 0 ? 2500 : 2000 + i * 1000);
    await waitForBudget(true); // 全体枠＋読み取り枠を先回りで確保
    const r = await fetch(`https://www.strava.com/api/v3/uploads/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    updateLimits(r);
    if (r.status === 429) {
      await handle429(r);
      continue;
    }
    const j = await r.json();
    if (j.activity_id) return { status: "success", info: String(j.activity_id) };
    if (j.error) {
      const info = j.error.replace(/<[^>]*>/g, "");
      return { status: /duplicate/i.test(j.error) ? "duplicate" : "error", info };
    }
  }
  return { status: "timeout", info: "" };
}

const csvCell = (s) => `"${String(s).slice(0, 100).replace(/"/g, "'")}"`;
function logCsv(name, status, info) {
  appendFileSync(csvPath, `${new Date().toISOString()},${name},${status},${csvCell(info)}\n`);
}

// ── メイン ──
const done = existsSync(donePath) ? new Set(JSON.parse(readFileSync(donePath, "utf8"))) : new Set();
const saveDone = () => writeFileSync(donePath, JSON.stringify([...done]));
if (!existsSync(csvPath)) writeFileSync(csvPath, "time,name,status,info\n");

const all = [];
collect(dir, all);
all.sort();
const queue = all.filter((p) => !done.has(basename(p)));
console.log(`全 ${all.length}件 / 未完了 ${queue.length}件 / 既完了 ${done.size}件`);

const counts = { success: 0, duplicate: 0, error: 0, timeout: 0 };
for (let i = 0; i < queue.length; i++) {
  const path = queue[i];
  const name = basename(path);
  const token = await accessToken();

  let res = await postUpload(token, path);
  while (res.status === 429) {
    await handle429(res);
    res = await postUpload(token, path);
  }

  if (res.status !== 201 && res.status !== 200) {
    const t = await res.text();
    logCsv(name, `http_${res.status}`, t);
    counts.error++;
    console.log(`${name}: POST ${res.status} (未完了のまま、次回再試行)`);
    continue; // 一時的失敗かもしれないので done にしない
  }

  const body = await res.json();
  if (!body.id) {
    logCsv(name, "error", body.error || JSON.stringify(body));
    counts.error++;
    done.add(name); // 受理されない=再試行しても同じ
    saveDone();
    continue;
  }

  const r = await pollUpload(token, body.id);
  logCsv(name, r.status, r.info);
  counts[r.status] = (counts[r.status] || 0) + 1;
  if (r.status === "success" || r.status === "duplicate" || r.status === "error") {
    done.add(name); // 確定したものは done (error はログに残してスキップ)
    saveDone();
  }

  if ((i + 1) % 25 === 0 || i === queue.length - 1) {
    console.log(
      `[${i + 1}/${queue.length}] 成功${counts.success} 重複${counts.duplicate} 失敗${counts.error} 時間切れ${counts.timeout} / 完了計${done.size}`
    );
  }
  await sleep(700); // 軽いスペーシング
}

console.log(
  `\n完了: 成功${counts.success} 重複${counts.duplicate} 失敗${counts.error} 時間切れ${counts.timeout}`
);
console.log(`結果ログ: ${csvPath}`);
