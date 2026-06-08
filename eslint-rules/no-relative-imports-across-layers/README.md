# no-relative-imports-across-layers

レイヤー（app / client / server / shared）をまたぐ相対 import（`../`）を禁止するルール。

## なぜ

層をまたぐ参照を相対パスで書くと、ファイル移動時に壊れやすく、依存方向も読み取りにくい。
層間は絶対パス（`@/*`）に統一する。同一層内の相対 import は許可。

## ❌ NG

```ts
// src/app/api/round-trip/route.ts
import { compute } from "../../server/usecases/compute";
```

## ✅ OK

```ts
// src/app/api/round-trip/route.ts
import { roundTripHandler } from "@/server/handlers/round-trip-handler";

// 同一層内の相対 import は OK
// src/server/usecases/bar.ts
import { foo } from "../lib/foo";
```

## 判定

- 元ファイルの層と、相対パスのセグメントから推定した参照先の層が異なる場合に違反。
- `shared` はどこからでも参照可（leaf）。
- `app`/`client` → `server` と、`app` ↔ `client` の相互参照を違反とする。

## 関連

- [no-direct-server-import](../no-direct-server-import/)
- [no-direct-layer-import](../no-direct-layer-import/)
