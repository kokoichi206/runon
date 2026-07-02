# CLAUDE.md — runon

開発者（および Claude）向けの内部メモ。非自明な運用と不変条件・gotcha のみ。
コマンド・依存は `package.json`、仕様・背景は `docs/` を参照。

## ブランチ運用

- **統合ブランチは `develop`。PR も派生ブランチの基点・向き先も `develop`（`main` ではない）。**
  default branch は `main` だが、日々の開発は develop に集約している。
- base 同期・conflict 解消は develop を取り込む。レビュー済み PR の履歴を壊さないよう、
  rebase ではなく `git merge origin/develop` を使う。

## server の層構成（不変条件）

`src/server` は **handler → usecase → repository** の 3 層。責務境界を崩さない。

- **外部 API 呼び出しは repository に閉じる**（Strava / Overpass 等）。handler・usecase から
  直接 fetch しない。新しい外部連携も repository として足し、usecase 越しに呼ぶ。
- **エラーは throw せず `Result` 型で返す**（`src/shared/result.ts`）。`server/`・`lib/` とも
  throw しない。外部 I/O は `safeTry` で Result に包むのが repository の役割。handler は Result を
  受けて分岐する（範例: `src/server/handlers/round-trip-handler.ts`）。
- **将来 LLM 推論をサーバ側に載せる前提**の層分け。裏側の推論呼び出しも repository に閉じる。

## ローカル起動・動作確認

- `pnpm dev`（Next.js、**ポート 3077**）。変更後は dev サーバを起動し、ユーザーがブラウザで
  確認できる状態にしてから完了とする。
- **worktree / 別ディレクトリで作業するときは、元リポの `.env.local` を持ち込んでから起動する。**
  worktree には env が無く、連携機能が動かず「起動できない」を誤って不具合と見なしやすい。
  `.env.local.example` はあるが値は空。
- Strava 連携キー（`STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`）は任意。未設定でもコア機能は動く。
