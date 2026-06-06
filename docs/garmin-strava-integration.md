# 練習データの自動取り込み（Garmin / Strava OAuth）調査メモ

トレーニング計画（`/training`）の練習履歴を、現状の **CSV 手動アップロード**に代えて
OAuth で自動取得できるか検討した結果のまとめ。

調査日: 2026-05（情報は変わり得るので各公式を要確認）。

## 結論（先に）

- **Garmin 公式 API を直接叩く OAuth は「ある」が、個人利用は対象外**（法人審査が必要）。趣味アプリには非現実的。
- 現実解は **Strava API（OAuth 2.0、セルフサービス）**。Garmin は活動を **公式・無料で自動的に Strava へ同期**するため、開発者から見た「Garmin データ」は Strava 経由で取れる。
- 自分の分だけなら Strava の **Single Player Mode** で審査不要・即利用可。
- 発行が必要なキー: **Strava アプリの Client ID / Client Secret のみ**。

## 選択肢の比較

| 方法 | 認証 | 個人利用 | 実情 |
|---|---|---|---|
| Garmin 公式（Connect Developer Program: Activity/Health/Training API） | OAuth 2.0 (PKCE) | 不可 | 「個人利用はサポートしない」と明記。法人情報＋用途審査（確認〜2営業日、連携1〜4週、本番は partner verification）。アクセストークンは3か月で失効しリフレッシュ必要 |
| **Strava API 経由**（推奨） | OAuth 2.0 | 可 | アプリ登録は即時。新規アプリは "Single Player Mode"＝自分のデータのみなら審査不要。他athlete連携は要審査 |
| 非公式 `garminconnect`（python 等） | ID/PW ログイン | △ | Garmin Connect 内部 API をスクレイプ。OAuth でない・ToS グレー・壊れやすい。個人スクリプト用途のみ |
| CSV アップロード（現状） | 不要 | 可 | ゼロ設定。Garmin Connect から `Activities.csv` を書き出して取り込む |

## Garmin 公式 API（参考）

- 全 API が **OAuth 2.0 PKCE**（3-legged）。ユーザーが Garmin Connect でログイン・権限同意 → 認可コード → アクセストークン交換。
- アクセストークンは **3か月で失効**。トークン取得のたびに新しいリフレッシュトークンが返る。
- **法人/事業者向け**。申請時に会社の法的情報・用途・利用 API（Health/Activity/Women's Health/Training/Courses）・redirect URL を登録。評価環境→本番は別審査。
- Activity API は承認後に評価環境で検証可能。Webhook(PUSH/PING) でアクティビティを受け取るモデル。

## Strava API（推奨ルートの詳細）

- **OAuth 2.0**。アクセストークンは **6時間で失効** → リフレッシュトークンで更新。
- 新規アプリは **Single Player Mode**（athlete capacity = 1）。自分のデータのみアクセス可。他人を繋ぐには Developer Program フォームの審査が必要。
- **レート制限**（既定）: 全体 200 req/15分・2000 req/日、非アップロード系 100 req/15分・1000 req/日。超過は 429。レスポンスヘッダ `X-RateLimit-Limit` / `X-RateLimit-Usage` で監視可。
- 推奨は **Webhook（push 型）** でポーリングを避ける。ただし Webhook は **公開 HTTPS エンドポイント**が必要（`hub.challenge` 応答）。ローカル/個人ならポーリングで十分。

## Garmin → Strava 自動同期

- 公式・無料。Garmin Connect アプリの「接続済みアプリ → Strava → 接続」、または `strava.com/upload/device`（古い端末は Garmin Express 経由）で連携。
- 連携後、Garmin Connect にアップロードされた活動は **数分以内に自動で Strava へ**。連携直後は **過去90日**も同期。
- 同期の ON/OFF は **Strava 側**の Third-Party Connections で管理。全件同期 or 全停止（個別選択不可）。
- 1 Garmin に複数 Strava を繋ぐと、最後に作った Strava にしか同期されない点に注意。

## このアプリに「Strava OAuth 取り込み」を足す場合の設計

取り込んだ活動は既存の `Activity` 型（`src/shared/types/training.ts`）に合わせるだけで、
計画ロジック（`generatePlan`）はそのまま使える。

1. **Strava アプリを発行**（Client ID / Client Secret、redirect URI を設定）— *ユーザーが用意するキー*
2. サーバールート追加:
   - `GET /api/strava/auth` … 認可画面へリダイレクト（scope: `activity:read`）
   - `GET /api/strava/callback` … 認可コード→トークン交換（**Client Secret はサーバー保持**）
3. `GET https://www.strava.com/api/v3/athlete/activities` を取得 → `Activity[]` にマップ（distance[m]→km、moving_time[s]、start_date、average_speed→ペース等）→ planner へ投入
4. トークン保管: 個人利用なら env か httpOnly Cookie に refresh token。Webhook は使わずポーリングで可（レート内）

> 現状アプリは localStorage 完結（サーバー状態なし）。OAuth 導入で「サーバー側のトークン交換・保管」という責務が増える。`/api/geo-ip` 等で使っている Next.js Route Handler がそのまま使える。

## 出典

- Garmin Activity API: https://developer.garmin.com/gc-developer-program/activity-api/
- Garmin Program FAQ: https://developer.garmin.com/gc-developer-program/program-faq/
- Garmin OAuth2 PKCE 仕様: https://developerportal.garmin.com/sites/default/files/OAuth2PKCE_1.pdf
- Strava Getting Started: https://developers.strava.com/docs/getting-started/
- Strava Rate Limits: https://developers.strava.com/docs/rate-limits/
- Garmin and Strava 連携 (Strava Support): https://support.strava.com/hc/en-us/articles/216918057-Garmin-and-Strava
