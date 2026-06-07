# no-dynamic-env-access

`process.env[expr]` のような動的アクセスを禁止するルール。

## なぜ

動的キーでの参照は型チェックを回避し、値の出処を不明にする。環境変数は
`@/shared/env` の `serverEnv`（zod で検証済み）から静的に参照することで、
存在・型・出処を一元管理する。

## ❌ NG

```ts
const key = "SITE_URL";
const url = process.env[key];
```

## ✅ OK

```ts
import { serverEnv } from "@/shared/env/server-env";

const url = serverEnv.SITE_URL;
```

静的な `process.env.SITE_URL` 自体はこのルールの対象外（`no-process-env` 側で
`src/shared/env/**` と設定ファイルのみ許可している）。

## 関連

- `no-process-env`（標準ルール）— env の直接参照は env モジュールに限定
