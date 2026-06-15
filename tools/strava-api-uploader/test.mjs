// API で少数ファイルを試験アップロードし、成功/重複/エラー/429 を確認する。
// 目的: Web の「最大数超え」上限と API が別枠かを判定する。
// 実行: node tools/strava-api-uploader/test.mjs <dir> [count=5]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const tokens = JSON.parse(readFileSync(here + "tokens.json", "utf8"));
const TOKEN = tokens.access_token;

const dir = process.argv[2];
const COUNT = parseInt(process.argv[3] || "5", 10);
if (!dir) {
  console.error("usage: node test.mjs <dir> [count]");
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

async function uploadOne(path) {
  const name = path.split("/").pop();
  const fd = new FormData();
  fd.append("data_type", dataType(name));
  fd.append("external_id", name);
  fd.append("file", new Blob([readFileSync(path)]), name);
  const r = await fetch("https://www.strava.com/api/v3/uploads", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  let body;
  try {
    body = await r.json();
  } catch {
    body = await r.text();
  }
  return { http: r.status, body };
}

async function poll(id) {
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const r = await fetch(`https://www.strava.com/api/v3/uploads/${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const j = await r.json();
    if (j.activity_id) return { status: "success", activity_id: j.activity_id };
    if (j.error)
      return { status: /duplicate/i.test(j.error) ? "duplicate" : "error", error: j.error };
  }
  return { status: "timeout" };
}

const all = [];
collect(dir, all);
all.sort();
const files = all.slice(0, COUNT);
console.log(`対象 ${all.length}件中、先頭 ${files.length}件を API で試験アップロード\n`);

for (const f of files) {
  const up = await uploadOne(f);
  console.log(`${f}\n  POST ${up.http} ${JSON.stringify(up.body)}`);
  if (up.http === 429) {
    console.log("  → 429: API も上限。Web と同じ枠の可能性大\n");
    continue;
  }
  if (up.body && up.body.id) {
    const res = await poll(up.body.id);
    console.log("  poll:", JSON.stringify(res), "\n");
  } else {
    console.log("  (id なし)\n");
  }
}
