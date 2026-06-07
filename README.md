# runon

**走るための周回路とトレーニング計画**を1つにしたランナー向け Web アプリ。
目標距離のループコースを地図から生成し、レースまでの練習メニューを自動で組み立てる。
計算は自前（OpenStreetMap + アルゴリズム）、描画は MapLibre、保存はブラウザ。**API キー不要・無料**。

- ダーク / ライトのテーマ切替（system / light / dark、地図タイルも連動）
- スマホ最適化（ボトムシート UI・safe-area 対応・PWA インストール可）

> 周回路アルゴリズムは論文 **Rhyd Lewis & Padraig Corcoran, _Fast Algorithms for
> Computing Fixed-Length Round Trips in Real-World Street Networks_, SN Computer Science
> 5:868 (2024)**（[doi:10.1007/s42979-024-03223-3](https://doi.org/10.1007/s42979-024-03223-3),
> オープンアクセス）を TypeScript で実装している。

## 機能

### 周回路 / 距離計算（`/`）

- 始点（地図クリック / 緯度経度入力 / プリセット / 現在地 GPS→失敗時 IP 概算 / 自宅登録）と
  目標距離を指定し、目標に近く往復の少ないループを複数生成
- 多目的最適化（距離誤差 / 区間重複%）でパレートフロント + 方位の異なる代替ループを地図描画
- エクスポート: GPX をスマホへ共有 / 保存（Web Share）、Google マップ近似リンク

### トレーニング計画（`/training`）

- 取込: Garmin の `Activities.csv` / Strava 連携（OAuth・任意）
- 走力推定（週間距離・最長走・イージーペース・VDOT・最大 HR）→ 期分けで漸進する練習メニュー
- 各日: 距離・推定時間・ペース・HR ゾーン・週1のポイント練習。目標タイムから VDOT 逆算と実現可能性

## デザイン / テーマ

- ブランド: **Ember**（エナジェティック・オレンジ）。アクセント `#FF5A1F`。
- 配色は `src/app/globals.css` の**セマンティックトークン（CSS 変数）**で一元管理。
  各コンポーネントは `bg-surface` / `text-fg` / `border-border` / `bg-accent` 等の意味クラスだけを使い、
  `<html data-theme="dark|light">` の切替で値が入れ替わる（`dark:` を撒かない方式）。
- テーマ選択（system/light/dark）は `localStorage` に保存し、OS 設定にも追従。
  初回描画前に `<head>` の同期スクリプトで `data-theme` を確定してチラつきを防ぐ。
- 地図は **CARTO** の `light_all` / `dark_all` ラスタータイルをテーマ連動で切替（キー不要・要 attribution）。
  ルート/マーカー色は `src/client/lib/map-style.ts` の `MAP_COLORS` で管理。

ブランド検討時の比較モックは `design/branding/`（`index.html` を開くと 5 案を並べて確認できる）。

## 必要なキー: なし

- **道路データ**: OpenStreetMap Overpass API（キー不要）
- **地図タイル**: MapLibre GL JS + CARTO ラスタータイル（キー不要・要 attribution）

別タイル（独自/商用/Google）へ替えたい場合は `src/client/lib/map-style.ts` のみ差し替えればよい設計。

## アルゴリズム（論文の KRT 問題）

開始点 s・目標長 k に対し、閉じた歩行で次の 2 目的を同時最小化する（多目的最適化）:

- `f1 = |k − L(S)|` 距離誤差
- `f2 = 既踏破区間の再通過割合(%)` 往復の重複

実装は 2 段構成:

1. **Stage 1 — 等時線多角形法** (`server/routing/round-trip.ts`)
   - `k/2` 到達圏を Dijkstra で算出 → 多方位・多アスペクトの楕円多角形ウェイポイント生成
   - 各レッグを Dijkstra で接続（既使用エッジに ×5 ペナルティ）→ out-and-back を除去し `(f1, f2)` 評価
2. **Stage 2 — パレート局所探索** (`server/routing/pareto-local-search.ts`, 論文 Algorithm 3 & 4)
   - 残余グラフ + ダミー頂点 + BFS 木による近傍操作で非支配解アーカイブを反復改善

## ディレクトリ構成

`app`/`client`/`server`/`shared` のレイヤリング（`@/*` エイリアス, Zod による env/入力検証）。

```
src/
  app/                 ルート + API + メタデータルート
    api/round-trip/route.ts   POST: 計算エンドポイント
    layout.tsx                metadata / viewport / テーマ初期化スクリプト
    globals.css               デザインシステム（Ember トークン + light/dark）
    icon.svg / apple-icon.png  ファビコン / Apple アイコン
    manifest.ts               PWA マニフェスト
  client/              UI（'use client'）
    components/  SiteNav / ThemeToggle / Logo / MapView / RoundTripPlanner / TrainingPlanner
    hooks/       useRoundTrip / useTrainingStore / useResolvedTheme
    lib/         theme.ts（テーマ管理） / map-style.ts（CARTO 切替 + ルート色）
  server/              handler / usecase / repository の一方向レイヤリング
    handlers/    route.ts から呼ぶ薄い入口（入力検証 + usecase 呼び出し）
    usecases/    オーケストレーション（compute-round-trips / strava）
    repositories/ 外部I/O（overpass / strava）。fetch を包み Result<T, AppError> を返す
    lib/         純粋ドメイン（routing / training / osm のグラフ構築。外部I/Oなし）
  shared/        env / errors（AppError）/ result（Result, safeTry）/ types（Zod スキーマ）
public/          og.png / icons/（PWA アイコン）
design/branding/ ブランド比較モック（探索用）
```

## 開発

```bash
pnpm install
pnpm dev            # http://localhost:3077
pnpm type-check     # 型チェック
pnpm test           # 単体テスト（合成グリッドで Dijkstra / 評価 / E2E / トレーニング計算を検証）
pnpm build          # 本番ビルド

# 起動中サーバへの実データ（Overpass）スモーク
pnpm rt:smoke
LAT=34.985 LNG=135.758 KM=5 PROFILE=bike pnpm rt:smoke
```

### 任意の環境変数

| 変数                                        | 用途                                             |
| ------------------------------------------- | ------------------------------------------------ |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava 連携を有効化（未設定なら未連携表示）      |
| `OVERPASS_ENDPOINT`                         | 公開 Overpass を避けて自前インスタンスを使う場合 |
| `OVERPASS_USER_AGENT`                       | OSM 利用エチケット用の User-Agent                |
| `SITE_URL`                                  | OG 画像等の絶対 URL 解決（未設定なら localhost） |

詳細仕様は `docs/`（`overview.md` が全体像の入口）。

## 注意 / 既知の制約

- 公開 Overpass はフェアユース（~1万クエリ/日, ~1GB/日, User-Agent 必須）。多用時は自前インスタンス推奨。
- 目標距離は 200m〜42.195km（フルマラソン）。長距離ほど計算が重くなるが全体締切（〜40 秒）で打ち切ってベスト候補を返す（東京中心で 3km ≈ 10 秒 / 25km・40km ≈ 40 秒）。取得半径は 15km にキャップしているので Overpass 負荷は距離に依らず一定。
- 地図タイル（CARTO / OSM）は利用規約に従うこと。多用時は独自/商用タイルへ。
- トレーニング計画は一般的なヒューリスティックであり、医学的・専門的助言ではない。

データ出典: © OpenStreetMap contributors (ODbL) · © CARTO
