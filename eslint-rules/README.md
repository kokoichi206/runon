# eslint-rules

runon 独自の ESLint カスタムルール群。レイヤードアーキテクチャ
（app → handlers → usecases → repositories/lib、shared は leaf）と Result 型による
エラー処理規約を、CLAUDE.md や口頭の約束ではなく **linter で** 強制する。

## 構成

各ルールは 1 ディレクトリ。`rule.js`（実装）/ `test.js`（RuleTester）/ `README.md`（仕様）を持つ。
`index.js` が全ルールを束ね、ルート `eslint.config.mjs` から `custom/<name>` として参照する。

## ルール一覧

| ルール                                                                    | 目的                                    | 主な対象                                   |
| ------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------ |
| [no-throw-statement](./no-throw-statement/)                               | throw を禁止し Result を強制            | `src/server/**`（test 除く）               |
| [no-direct-server-import](./no-direct-server-import/)                     | 外部からは handlers のみ参照            | `src/server/` 外                           |
| [no-direct-layer-import](./no-direct-layer-import/)                       | 層の依存方向を強制                      | `src/app/**`, `src/server/repositories/**` |
| [no-relative-imports-across-layers](./no-relative-imports-across-layers/) | 層跨ぎの相対 import 禁止                | 全層                                       |
| [no-dynamic-env-access](./no-dynamic-env-access/)                         | `process.env[expr]` を禁止              | 全層                                       |
| [no-error-message-comparison](./no-error-message-comparison/)             | `.message` 比較を禁止（`.type` を使う） | 全層                                       |
| [no-to-locale-string](./no-to-locale-string/)                             | `toLocaleString()` を禁止（`Intl.*`）   | 全層                                       |
| [no-browser-notifications](./no-browser-notifications/)                   | `alert`/`confirm`/`prompt` を禁止       | 全層                                       |
| [max-api-route-handler-lines](./max-api-route-handler-lines/)             | route を薄く保つ                        | `src/app/api/**/route.ts`                  |

## テスト

ルールのテストはルートの vitest（unit プロジェクト）に含まれる。

```sh
pnpm test                       # 全テスト（ルールのテスト含む）
pnpm exec vitest run --project unit   # ロジック + ルールのテストのみ
```

## 新しいルールの追加手順

1. `eslint-rules/<name>/rule.js` に実装（`meta` / `create` を持つ ESLint ルール）
2. `eslint-rules/<name>/test.js` に RuleTester で valid / invalid を記述
3. `eslint-rules/<name>/README.md` に Why と NG/OK 例
4. `eslint-rules/index.js` に import を追加
5. `eslint.config.mjs` の適切なスコープ（`files`）で `custom/<name>` を有効化
