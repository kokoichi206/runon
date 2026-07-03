# Strava API Uploader

Strava 公式 API（`/api/v3/uploads`）で活動ファイルを一括アップロードする Node CLI（依存なし、Node18+）。
Web の一括アップローダより上限枠が大きいため、数千件の移行に向く。

## ファイル

- `auth.mjs` — OAuth でトークンを取得し `tokens.json` に保存
- `test.mjs` — 数件だけ試験アップロード（疎通・上限確認用）
- `upload.mjs` — 本番。全件アップロード（レート制限順守・再開・CSV記録）
- `secrets.example.json` — `secrets.json` のテンプレート（実値なし・コミット対象）
- `secrets.json` — Client ID / Secret（**gitignore 済み・コミット禁止**）
- `tokens.json` / `done.json` / `results.csv` — 実行で生成（**gitignore 済み**）

## セットアップ（Strava API アプリ作成・設定）

1. **API アプリを登録**: `https://www.strava.com/settings/api` を開く。
   - アプリケーション名 / カテゴリー: 任意
   - ウェブサイト: 任意の URL（例 `https://example.com`）
   - **認証コールバックドメイン: `localhost`**（OAuth リダイレクト先のドメイン。`http://` やパス・ポートは付けない）
   - 規約に同意して作成 → **Client ID** と **Client Secret** が発行される
   - スコープはこの登録画面では選ばない。`auth.mjs` が OAuth 時に `activity:write` を要求する。
2. **設定ファイルを作成**: テンプレートをコピーして実値を入れる。

   ```bash
   cp tools/strava-api-uploader/secrets.example.json tools/strava-api-uploader/secrets.json
   # secrets.json を編集し client_id / client_secret を記入
   ```

   `secrets.json` は **gitignore 済み**（コミットされない）。

## 使い方

```bash
# 1. 認可（ブラウザで activity:write を承認 → トークン保存）
node tools/strava-api-uploader/auth.mjs

# 2. 疎通確認（5件だけ。既出フォルダなら duplicate になり新規作成なし）
node tools/strava-api-uploader/test.mjs <dir> 5

# 3. 本番（全件。途中で止めても再実行で続きから）
node tools/strava-api-uploader/upload.mjs <dir>
```

## 挙動

- 各ファイルを `POST /uploads` → `GET /uploads/:id` で 成功/重複/エラー を確定し `results.csv` に記録。
- 成功・重複・確定エラーは `done.json` に記録し、**再実行時はスキップ**（タブやプロセスが落ちても続きから）。
- レート制限ヘッダ（`X-RateLimit-*` 全体枠 / `X-ReadRateLimit-*` 読み取り枠）を毎回読み、**上限に達する前に**15分枠・日枠のリセットまで先回りで待つ（429 はあくまで保険）。
- 重複は Strava が弾くので、**何度実行しても二重登録されない**。

## 注意

- レート制限上、確認付きで概ね **~1,000〜2,000 件/日**。数千件は数日かけて無人で流れる（放置でOK）。
- 別アカウント（例: 友人）へ入れる場合は、そのアカウントで `auth.mjs` を実行してトークンを取り直す（アップロード先＝トークン所有者）。
- 実行は macOS/Linux 想定（`here` のパス解決）。Windows で直接動かす場合は調整が必要。
- `secrets.json` の Client Secret は機微情報。用が済んだら Strava 側で再発行推奨。
