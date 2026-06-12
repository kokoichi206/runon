# max-api-route-handler-lines

API route handler（`src/app/api/**/route.ts`）の行数上限を強制するルール。

## なぜ

route は「HTTP の入出力変換」だけを担い、ロジックは `@/server/handlers` 以降へ寄せる。
route が膨らむのはロジック流入のサイン。薄さを機械的に保つ。

## ❌ NG

route.ts に検証・整形・外部呼び出しなどを直接書いて肥大化（既定 80 行超）。

## ✅ OK

```ts
// src/app/api/round-trip/route.ts
import { roundTripHandler } from "@/server/handlers/round-trip-handler";

export async function POST(req: Request) {
  const result = await roundTripHandler(await req.json());
  return result.ok
    ? Response.json(result.value)
    : Response.json({ error: result.error.message }, { status: httpStatusFor(result.error) });
}
```

## オプション

```js
"custom/max-api-route-handler-lines": ["error", { maxLines: 80 }]
```

空行・コメント行（`//` 始まり、`/* ... */` ブロック）は行数に数えない。

## 対象

`src/app/api/**/route.ts` のみ。
