# no-throw-statement

server コード（`src/server/**`、テスト除く）での `throw` を禁止し、`@/shared/result` の
Result 型でエラーを表現させるルール。

## なぜ

`throw` は制御フローを暗黙化し、呼び出し側に「失敗しうる」ことを型で伝えられない。
Result 型なら戻り値の型に成否が現れ、分岐忘れを TypeScript が検出できる。

## ❌ NG

```ts
// src/server/usecases/compute-round-trips.ts
export function compute(input) {
  if (!input.start) {
    throw new Error("start is required");
  }
  // ...
}
```

## ✅ OK

```ts
import { ok, err, type Result } from "@/shared/result";
import { appError, type AppError } from "@/shared/errors";

export function compute(input): Result<Plan, AppError> {
  if (!input.start) {
    return err(appError.validation("始点を指定してください"));
  }
  return ok(plan);
}
```

## 適用範囲

- 対象: `src/server/**/*.ts`
- 除外: `src/server/**/*.test.ts`（テストは Result の型ナローイング等で意図的に throw するため）
- `try`/`catch` で外部例外を受けて `err()` に変換するのは推奨パターン（catch 自体は禁止しない）。

## 関連

- [no-error-message-comparison](../no-error-message-comparison/) — エラー種別は `.type` で判定する
