# no-direct-server-import

`src/server/` の外（app / client）からの `@/server/*` 直接 import を禁止し、
`@/server/handlers/*` 経由のみ許可するルール。

## なぜ

server ロジックを `src/server/` 内に閉じ込め、外部からは公開境界である handlers
経由でのみ呼ばせる。ブラウザでも使う純粋ドメインロジック（例: training 計算）は
server ではなく `@/shared/` に置く。

## ❌ NG

```ts
// src/client/components/TrainingPlanner.tsx
import { generatePlan } from "@/server/lib/training/plan"; // server の内部
```

## ✅ OK

```ts
// API route は handlers 経由
import { roundTripHandler } from "@/server/handlers/round-trip-handler";

// ブラウザでも使う純粋ロジックは shared へ
import { generatePlan } from "@/shared/training/plan";
```

## 判定

- `src/server/` 内のファイルは対象外。
- 外部ファイルが `@/server/*`（`@/server/handlers` 以外）を import したら違反。

## 関連

- [no-direct-layer-import](../no-direct-layer-import/) — 層内の依存方向
