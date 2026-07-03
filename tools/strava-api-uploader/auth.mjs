// Strava OAuth: 認可URLを開き、localhost で code を受け取り、トークンに交換して保存する。
// 依存なし(Node18+ の標準 fetch/http/fs)。実行: node tools/strava-api-uploader/auth.mjs
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const here = new URL(".", import.meta.url).pathname;
const secrets = JSON.parse(readFileSync(here + "secrets.json", "utf8"));

const PORT = 8721;
const REDIRECT = `http://localhost:${PORT}/exchange_token`;
const SCOPE = "activity:write"; // アップロードに必要なのはこれだけ

const authUrl =
  `https://www.strava.com/oauth/authorize?client_id=${secrets.client_id}` +
  `&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&approval_prompt=force&scope=${SCOPE}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/exchange_token") {
    res.end("ok");
    return;
  }
  const code = url.searchParams.get("code");
  const grantedScope = url.searchParams.get("scope");
  if (!code) {
    res.end("code がありません");
    return;
  }
  try {
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: secrets.client_id,
        client_secret: secrets.client_secret,
        code,
        grant_type: "authorization_code",
      }),
    });
    const tok = await r.json();
    if (!tok.access_token) throw new Error(JSON.stringify(tok));
    writeFileSync(here + "tokens.json", JSON.stringify(tok, null, 2));
    res.end("認可成功。ターミナルに戻ってください。このタブは閉じてOK。");
    console.log("✅ トークン取得・保存しました");
    console.log("   scope:", grantedScope);
    console.log("   athlete:", tok.athlete?.id, tok.athlete?.username);
  } catch (e) {
    res.end("トークン交換に失敗: " + e);
    console.error("❌ トークン交換失敗:", e);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log("認可URL（開かなければ手動でブラウザに貼ってください）:\n" + authUrl + "\n");
  if (process.platform === "darwin") spawn("open", [authUrl]);
});
