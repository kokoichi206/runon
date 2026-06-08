# no-direct-layer-import

レイヤーアーキテクチャの依存方向を強制するルール。

依存方向: **app → handlers → usecases → repositories / lib**（shared は leaf）

## なぜ

層を飛ばした参照（app から repositories/lib を直接）や、逆방向の参照
（repositories から usecases）は依存関係を壊し、テスト・変更を難しくする。

## ❌ NG

```ts
// src/app/api/round-trip/route.ts （usecases を飛ばして repositories/lib へ）
import { overpassRepository } from "@/server/repositories/overpass-repository";
import { buildGraph } from "@/server/lib/osm/build-graph";

// src/server/repositories/overpass-repository.ts （依存方向が逆転）
import { computeRoundTrips } from "@/server/usecases/compute-round-trips";
```

## ✅ OK

```ts
// app は handlers 経由
import { roundTripHandler } from "@/server/handlers/round-trip-handler";

// usecases → repositories/lib は順方向
import { overpassRepository } from "@/server/repositories/overpass-repository";
```

## 判定

- `src/app/**` が `@/server/repositories/*` または `@/server/lib/*` を import → `noDirectLayerImport`
- `src/server/repositories/**` が `@/server/usecases/*` を import → `noReverseLayerImport`

## 関連

- [no-direct-server-import](../no-direct-server-import/) — 外部からは handlers のみ
