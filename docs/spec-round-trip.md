# 仕様書: Fixed-Length Round Trip（目標距離の周回路生成）

本書は本リポジトリの既存機能「目標距離の周回路（出発点に戻るループ）生成」の仕様を、実装に忠実に記述したものである。記載した数値・関数名・しきい値はすべてソースコードの実挙動に基づく（推測値ではない）。

---

## 1. 概要と出典

開始点 `s` と目標距離 `k`（メートル）を入力として、`s` に戻る閉じた歩行（周回路）を複数生成する機能である。「目標距離にできるだけ近く」「同じ道の往復（重複）ができるだけ少ない」という 2 つの目的を同時に満たす経路群（パレートフロント）を返す。

### 出典論文

- Rhyd Lewis & Padraig Corcoran, _Fast Algorithms for Computing Fixed-Length Round Trips in Real-World Street Networks_, SN Computer Science **5:868** (2024).
- DOI: [10.1007/s42979-024-03223-3](https://doi.org/10.1007/s42979-024-03223-3)（オープンアクセス）

### 採用手法

本実装が採用しているのは、論文中の **「等時線多角形法（isochrone polygon method）」+「多目的パレート局所探索（multi-objective Pareto local search, Algorithm 3 & 4）」** の組み合わせである。論文には contraction hierarchies（CH）に基づく高速化も登場するが、**本実装は CH を用いていない**。グラフは取得した局所範囲（取得半径以内）のみを対象とし、`nearestNode` は線形走査、Dijkstra は素直な二分ヒープ実装である。

---

## 2. 問題定義（KRT）

論文の KRT（K-length Round Trip）問題に対応する。有向・弧重み付きストリートグラフ `G = (V, A, w)`（頂点=交差点/端点、弧=道路セグメント、重み=メートル距離。`src/server/routing/graph.ts` の `StreetGraph`）上で、開始ノード `s` に始まり `s` に戻る閉じた歩行 `S` を対象とし、以下の 2 目的を同時最小化する多目的最適化として定式化される（`src/server/routing/walk.ts` の `WalkMetrics`、論文 Definition 6）。

- `f1(S) = |k − L(S)|` … 目標距離との誤差（`lengthError`）。`L(S)` は歩行の実距離。
- `f2(S) = 100 × ( Σ_{多重度 x の無向辺} (x−1)·w ) / L(S)` … 既踏破区間の再通過割合（%）（`overlapPercent`）。同じ無向辺を `x` 回通ると `(x−1)·w` が重複長として計上される。

出力は単一最適解ではなく **パレートフロント**（互いに支配し合わない非支配解集合）である。支配関係 `dominates(a, b)` は「`a` が `f1, f2` の両方で `b` 以下、かつ少なくとも片方で真に小さい」と定義される（`src/server/routing/walk.ts`）。

---

## 3. データ源とライセンス

### 計算用データ（経路グラフの源）: OpenStreetMap / Overpass API

- 取得元: Overpass API（既定エンドポイント `https://overpass-api.de/api/interpreter`、`src/server/osm/overpass.ts` の `DEFAULT_ENDPOINT`）。
- **APIキー不要**。OSM の利用エチケットに従い `User-Agent` を必ず付与する（既定値 `fixed-length-round-trip/0.1 (https://github.com/kokoichi206/til; til research demo)`）。
- ライセンス: **ODbL**。計算・派生データ生成・キャッシュが許容される。レスポンスの `attribution` フィールドに `© OpenStreetMap contributors (ODbL)`（`compute-round-trips.ts` の `ATTRIBUTION`）を含める。

### 描画用データ（地図タイル）: OSM ラスタータイル

- `src/client/lib/map-style.ts` の `osmRasterStyle` が `https://tile.openstreetmap.org/{z}/{x}/{y}.png` を使用（MapLibre GL JS、キー不要）。

### Google Maps を計算に使わない理由（結論）

- **計算用途には使用不可**: Google Maps Platform ToS（3.2.3）は Google のデータから独自の経路グラフ/データセットを作成・キャッシュすることを禁止しているため、カスタム経路アルゴリズムの計算データ源にできない。
- **描画専用なら可能だが採用しない**: 描画自体は可能だが、課金アカウントと API キーが必須。本実装は無料・キー不要を優先し OSM を採用。Google Maps 風の見た目にしたい場合は `src/client/lib/map-style.ts` の差し替えのみで対応できる設計（描画層は抽象化済み）。

---

## 4. 入力 / 出力

### 4.1 リクエスト型（`src/shared/types/round-trip.ts`）

`roundTripRequestSchema`（Zod）:

| フィールド     | 型 / 制約                    | 既定値                     | 単位 / 備考                                                                                               |
| -------------- | ---------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| `lat`          | `number`, `-90 ≤ lat ≤ 90`   | なし（必須）               | 緯度                                                                                                      |
| `lng`          | `number`, `-180 ≤ lng ≤ 180` | なし（必須）               | 経度                                                                                                      |
| `targetMeters` | `number`, `200 ≤ v ≤ 25_000` | なし（必須）               | 目標周回距離 `k`（m）。200m 未満は道路網として意味が薄く、25km 超は公開 Overpass への負荷が大きいため制限 |
| `profile`      | `"walk"                      | "bike"`（`profileSchema`） | `"walk"`                                                                                                  | 移動プロファイル |

### 4.2 レスポンス型（`RoundTripResult`）

- `start: LngLat` … `start` に最も近い道路ノードへスナップした実際の始点。
- `recommendedId: string` … 推奨候補の `id`（パレートフロントから重み付けで選択）。
- `candidates: RoundTripCandidate[]` … 全候補（パレートフロント + 多様性参考解）。本実装では後述の `score` 昇順（型コメント上は「lengthError 昇順」）。
- `stats: { graphNodes, graphEdges, reachableNodes, computeMs, overpassMs }` … 計算統計。
- `attribution: string` … `© OpenStreetMap contributors (ODbL)`。

`RoundTripCandidate`:

| フィールド       | 型                   | 意味                                                                      |
| ---------------- | -------------------- | ------------------------------------------------------------------------- | -------------------- | ---------------- |
| `id`             | `string`             | `cand-<idx>` 形式                                                         |
| `path`           | `LngLat[]`           | 周回経路の全ポリライン（始点=終点）。座標順 `[lng, lat]`（GeoJSON 順）    |
| `waypoints`      | `LngLat[]`           | 多角形ウェイポイント（可視化・デバッグ用）。PLS 由来解では `[start]` のみ |
| `lengthMeters`   | `number`             | 実距離 `L(S)`（m、四捨五入）                                              |
| `lengthError`    | `number`             | `f1 =                                                                     | k − L(S)             | `（m、四捨五入） |
| `overlapPercent` | `number`             | `f2`（%、小数第1位に丸め）                                                |
| `onParetoFront`  | `boolean`            | パレートフロント上の解なら `true`、多様性候補なら `false`                 |
| `source`         | `"isochrone-polygon" | "pareto-local-search"`                                                    | 候補を生み出した手法 |

### 4.3 単位・座標順

- 距離はすべてメートル。`LngLat = [number, number]` は **`[lng, lat]`**（GeoJSON 順）。入力 `lat`/`lng` は個別フィールド、出力座標は `[lng, lat]` 配列という非対称に注意。

---

## 5. アルゴリズム

全体オーケストレーションは `src/server/usecases/compute-round-trips.ts` の `computeRoundTrips`。流れは「Overpass 取得 → 有向グラフ構築 → 始点スナップ → 到達圏算出 → Stage1 等時線多角形法 → Stage2 パレート局所探索 → 候補整形」。

### 5.0 前処理

| ステップ       | 処理                                                                                                                                                                            | ソース                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 道路網取得     | `fetchRadiusMeters(targetMeters)` の半径で Overpass にクエリ                                                                                                                    | `compute-round-trips.ts` / `overpass.ts: fetchStreetNetwork, buildOverpassQuery` |
| 有向グラフ構築 | way 群を頂点・弧へ変換。`profile=walk` は全弧双方向、`bike` は `oneway` を解釈                                                                                                  | `build-graph.ts: buildGraphFromOverpass, travelDirection`                        |
| 始点スナップ   | `snapStart(graph, center, 400)`。最近傍ノードが 400m を超えると `null`（呼び出し側でエラー化）。関数の既定上限は 500m だが呼び出しでは 400 を明示                               | `round-trip.ts: snapStart`                                                       |
| 到達圏算出     | `computeReachable(graph, startNode, targetMeters * 0.6)`。距離上限 `0.6k` 内のノード集合と最遠ノード方位 `baseBearingDeg` を得る（論文 `k/2` 等時線に相当、少し余裕を持たせる） | `isochrone.ts: computeReachable` / `dijkstra.ts`                                 |

`buildGraphFromOverpass` の一方通行解釈（`travelDirection`、bike のみ適用）:

- `oneway` が `yes`/`true`/`1` → forward、`-1`/`reverse` → reverse。
- `junction=roundabout`/`circular` かつ未指定 → forward。
- `oneway:bicycle=no` → both（上書き）、`oneway:bicycle=yes` → forward。
- way の `nodes` と `geometry` の長さが不一致、または 2 点未満の way はスキップ。

無向エッジキー `undirectedEdgeKey(a,b)`（`graph.ts`）は `小id_大id` 形式で、重複カウント（`f2`）と Dijkstra の再使用ペナルティで共有される。

### 5.1 Stage 1: 等時線多角形法（`src/server/routing/round-trip.ts`）

| ステップ          | 処理                                                                                                                                                                                                                                  | 関数                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 多角形生成        | 始点を頂点0に固定した楕円多角形を、複数方位・複数アスペクト・複数頂点数で生成。`baseBearingDeg` を起点に `bearingCount` 本の方位をスイープ                                                                                            | `generatePolygons` → `buildPolygon`                     |
| 楕円配置          | ローカル平面（forward=β方向 `u`, perp=直交 `v`）の楕円上に `n` 頂点を配置（`φ0 = π` で頂点0が後端=始点）。仮半径 `baseR=1000` で周長を計算し、実周長が `targetMeters` になるよう一様スケール                                          | `buildPolygon`                                          |
| 地表投影          | 各ローカルオフセットを `destinationPoint`（大圏航法）で緯度経度へ変換                                                                                                                                                                 | `geo.ts: destinationPoint, bearingDeg, haversineMeters` |
| ノードスナップ    | 各頂点を `nearestNode` で最近傍ノードへ。頂点0は `startNode` 固定。到達圏（`reachable.dist`）に無いノードは棄却（`null`）                                                                                                             | `routePolygon`                                          |
| 連続重複除去      | スナップ結果 `[...snapped, startNode]` から連続重複を畳み込み。3 ノード未満なら棄却                                                                                                                                                   | `routePolygon`                                          |
| レッグ経路化      | 隣接ウェイポイント間を `shortestPath`（Dijkstra）で接続。既使用エッジ集合 `usedEdgeKeys` を `penalizedEdgeKeys` として渡し、再使用に `penaltyFactor` 倍のコストを課して重複を抑制。各レッグ確定後に通過エッジを `usedEdgeKeys` に追加 | `routePolygon` / `dijkstra.ts: shortestPath, dijkstra`  |
| 閉路検証          | 末尾が `startNode` でなければ棄却                                                                                                                                                                                                     | `routePolygon`                                          |
| out-and-back 除去 | `removeOutAndBack` で U ターンの行き止まり（`[..,A,B,A,..] → [..,A,..]`）を反復畳み込み。3 ノード未満なら棄却                                                                                                                         | `walk.ts: removeOutAndBack`                             |
| 評価              | `evaluateWalk` で `(f1, f2)` を算出                                                                                                                                                                                                   | `walk.ts: evaluateWalk`                                 |
| 退化解棄却        | `L(S) < k×0.3` または `L(S) > k×3` の解を棄却                                                                                                                                                                                         | `routePolygon`                                          |

Stage1 で 1 件も候補が生成できなければエラー（`RoundTripError`）。

#### Dijkstra の重要な性質（`src/server/routing/dijkstra.ts`）

- 二分ヒープ（`MinHeap`）による優先度付きキュー。
- **優先度はペナルティ込みコスト（`cost`）で決めるが、`dist` には実距離（ペナルティ抜き）を記録する**。これにより「重複を避けつつ長さ評価は実距離で行う」を両立。
- `penaltyFactor` 既定値 = `5`（`opts.penaltyFactor ?? 5`）。`penalizedEdgeKeys` に含まれる無向エッジは `weightM × penalty` でコスト計上。
- `maxDistanceM`: 実距離がこの値を超えるノードは展開しない（等時線用）。
- `target`: 到達したら探索打ち切り（単一目的地探索の高速化）。
- `blockedArcs`: 有向弧 `"from->to"` を遮断（PLS の残余グラフ用）。
- `reconstructPath` は循環防御付き。

### 5.2 Stage 2: パレート局所探索（PLS, `src/server/routing/pareto-local-search.ts`）

論文 Algorithm 3（PLS 本体）と Algorithm 4（近傍生成）に対応。

#### 近傍生成 `generateNeighbors`（Algorithm 4）

- 歩行 `S` の有向弧集合 `removedArcs`（`arcsOf`）を求め、これを除いた**残余グラフ**上で各カット頂点 `ui` を根に **1 回の BFS**（`bfsResidualTree`）を行う。
- `ui` へ戻る入弧は**ダミー頂点 `DUMMY = -1`**（OSM ノード ID は正なので衝突しない）へ張り替える。
- BFS 木の `parent` から `pathTo` で経路復元し、2 種類の近傍を生成:
  - **(a) 区間置換**: `S[i..j]` を残余グラフ上の `ui..uj` 新経路で置換。
  - **(b) サブサイクル付加**: `ui → ui'(DUMMY)` の閉路（`cyc`、長さ 3 以上）を末尾を `ui` に戻して `ui` 位置に挿入。
- カット頂点 `i` は等間隔サンプル（最大 `maxCutVertices`、既定 `24`）。区間終点 `j` は `i+2..len-1` を等間隔サンプル（最大 `maxSegmentTargets`、既定 `6`、末尾 `len-1` は必ず含める）。
- 各近傍は `finalize` で正規化: 始終点が `startNode`、`removeOutAndBack` 適用、3 ノード未満棄却、退化解棄却（`L < k×0.3` または `L > k×3`）。

#### PLS 本体 `paretoLocalSearch`（Algorithm 3）

- アーカイブ `archive`（非支配解集合）と未訪問キュー `unvisited`、訪問済みシグネチャ集合 `visited` を保持。
- シグネチャ `signatureOf(m) = round(lengthMeters):round(overlapPercent×10)`。同一シグネチャの再展開を防ぐ。
- `tryInsert`: 既存解に支配される、または `(f1,f2)` 完全一致なら不挿入。挿入時は `cand` に支配される既存解を除去。
- アーカイブが `maxArchive` を超えたら **overlap 最大の解を 1 つ間引く**。
- 終了条件: `unvisited` が空、`iterations ≥ maxIterations`、または経過時間 `> timeBudgetMs`。

`computeRoundTrips` からの呼び出し時パラメータは `maxIterations: 250, maxArchive: 40, timeBudgetMs: 5000`（関数内部の既定は `300 / 40 / 4000` だが呼び出しが上書き）。`deps.enableLocalSearch === false` の場合は Stage1 の初期解集合をそのまま使う。

### 5.3 候補整形・推奨選択（`compute-round-trips.ts`）

- スコア `score(m, k) = lengthError/k + overlapPercent/100`（小さいほど良い）。
- PLS の返したフロントを `score` 昇順にソートし `onFront=true` とする（`frontSorted`）。
- **多様性候補**: 最適解（`f1≈0, f2≈0`）がほぼ全候補を支配しフロントが小さくなりがちなため、Stage1 候補を方位の **45° バケット**ごとに最良 1 件残し、フロントに無いものを `onFront=false` で追加。
- フロント + 多様性候補を結合し、先頭から最大 **8 件**（`combined.slice(0, 8)`）を返す。
- `recommendedId`: `frontSorted` 先頭（最良スコアのフロント解）に対応する候補の `id`。該当が無ければ先頭候補。
- `source` 判定: Stage1 のシグネチャ表に一致すれば `isochrone-polygon`、なければ `pareto-local-search`。

---

## 6. パラメータと既定値（実コードの値）

| パラメータ                                  | 値                                                       | 定義箇所                                                                              |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 多角形頂点数 `vertexCounts`                 | `[4]`                                                    | `round-trip.ts: DEFAULTS`                                                             |
| 方位スイープ本数 `bearingCount`             | `8`（= 45° 刻み）                                        | `round-trip.ts: DEFAULTS`                                                             |
| 楕円アスペクト `aspects`（[along, across]） | `[[1, 1], [1.5, 0.7], [0.7, 1.3]]`                       | `round-trip.ts: DEFAULTS`                                                             |
| 再使用ペナルティ係数 `penaltyFactor`        | `5`                                                      | `round-trip.ts: DEFAULTS` / `dijkstra.ts`（`?? 5`） / 呼び出し `routePolygon(..., 5)` |
| 多角形仮半径 `baseR`                        | `1000`                                                   | `round-trip.ts: buildPolygon`                                                         |
| 取得半径                                    | `Math.min(15_000, Math.round(targetMeters * 0.6 + 200))` | `compute-round-trips.ts: fetchRadiusMeters`                                           |
| 到達圏距離上限                              | `targetMeters * 0.6`                                     | `compute-round-trips.ts` → `computeReachable`                                         |
| 始点スナップ上限                            | 呼び出し `400`m（関数既定 `500`m）                       | `compute-round-trips.ts` / `round-trip.ts: snapStart`                                 |
| 到達圏ノード下限                            | `reachable.dist.size < 5` でエラー                       | `compute-round-trips.ts`                                                              |
| 退化解棄却しきい値                          | `L(S) < k×0.3` または `L(S) > k×3`                       | `round-trip.ts: routePolygon` / `pareto-local-search.ts: finalize`                    |
| PLS `maxIterations`                         | `250`（呼び出し）/ `300`（既定）                         | `compute-round-trips.ts` / `pareto-local-search.ts`                                   |
| PLS `maxArchive`                            | `40`                                                     | 両方                                                                                  |
| PLS `timeBudgetMs`                          | `5000`（呼び出し）/ `4000`（既定）                       | `compute-round-trips.ts` / `pareto-local-search.ts`                                   |
| 近傍 `maxCutVertices`                       | `24`                                                     | `pareto-local-search.ts: generateNeighbors`                                           |
| 近傍 `maxSegmentTargets`                    | `6`                                                      | `pareto-local-search.ts: generateNeighbors`                                           |
| 多様性バケット                              | 方位 45° 刻み                                            | `compute-round-trips.ts`                                                              |
| 返却候補上限                                | `8` 件                                                   | `compute-round-trips.ts`                                                              |
| 地球半径 `EARTH_RADIUS_M`                   | `6_371_008.8`                                            | `geo.ts`（WGS84 平均半径）                                                            |

その他の定数:

- Overpass クエリ: `[out:json][timeout:60];`、`out geom;`。
- 除外 highway: `motorway|motorway_link|trunk|trunk_link|construction|proposed|abandoned|raceway|bus_guideway|escape|corridor|platform`、加えて `area=yes` と `access=private|no` を除外。
- `walk`: `["foot"!~"no"]` を追加。`bike`: `["bicycle"!~"no"]["highway"!~"steps|footway|pedestrian"]` を追加。

---

## 7. API

### エンドポイント

`POST /api/round-trip`（`src/app/api/round-trip/route.ts`、`runtime = "nodejs"`, `maxDuration = 60`）。

### リクエスト例

```json
{
  "lat": 34.985,
  "lng": 135.758,
  "targetMeters": 5000,
  "profile": "walk"
}
```

`profile` は省略可（既定 `"walk"`）。

### レスポンス例（200）

```json
{
  "start": [135.7581, 34.9849],
  "recommendedId": "cand-0",
  "candidates": [
    {
      "id": "cand-0",
      "path": [
        [135.7581, 34.9849],
        [135.7592, 34.9853],
        [135.7581, 34.9849]
      ],
      "waypoints": [
        [135.7581, 34.9849],
        [135.761, 34.988],
        [135.756, 34.987]
      ],
      "lengthMeters": 4980,
      "lengthError": 20,
      "overlapPercent": 3.2,
      "onParetoFront": true,
      "source": "isochrone-polygon"
    }
  ],
  "stats": {
    "graphNodes": 4213,
    "graphEdges": 9876,
    "reachableNodes": 1502,
    "computeMs": 8421,
    "overpassMs": 2310
  },
  "attribution": "© OpenStreetMap contributors (ODbL)"
}
```

（`path`/`waypoints` の座標値は説明用の例。`onParetoFront=false` の候補は多様性参考解。）

### エラーレスポンス

| HTTP  | 契機                                                             | ボディ                                             |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `400` | JSON ボディが解析不能                                            | `{ "error": "JSON ボディが不正です。" }`           |
| `400` | Zod バリデーション失敗（範囲外の `lat`/`lng`/`targetMeters` 等） | `{ "error": "入力が不正です。", "issues": [...] }` |
| `422` | `RoundTripError`（業務的に経路が作れない）                       | `{ "error": "<理由メッセージ>" }`                  |
| `502` | その他の例外（Overpass 通信失敗・混雑等）                        | `{ "error": "計算に失敗しました: <message>" }`     |

`422`（`RoundTripError`）が返る具体ケース（`compute-round-trips.ts`）:

- 対象道路が 0 件（`ways.length === 0`）。
- 始点スナップ失敗（最近傍が 400m 超）。
- 到達圏ノードが 5 未満（道路網が疎すぎ）。
- Stage1 候補が 0 件。

Overpass の `429`/`504` は `overpass.ts` で「混雑」メッセージの `Error` として投げられ、`RoundTripError` ではないため最終的に `502` になる。

注: 入力フィールド名や検証はこの仕様の正であり、本書 4.1 の Zod 制約（`targetMeters` 上限 25,000m など）に従う。

---

## 8. 既知の制約と注意

- **Overpass フェアユース**: 公開 Overpass はフェアユース制限（おおむね 1 万クエリ/日、1GB/日、`User-Agent` 必須）。多用時は自前インスタンス（`OVERPASS_ENDPOINT`）推奨。本実装は 1 リクエスト = 1 Overpass クエリ、キャッシュ無し。
- **計算時間の目安**: 取得 + 探索で数秒（`maxDuration = 60`）。東京中心 2.5km で約 8〜10 秒、うち Overpass 1.5〜3 秒（README 記載の実測目安）。`targetMeters` が大きいほど取得半径・グラフ・探索が重くなる。
- **取得半径の上限**: `fetchRadiusMeters` は 15km で頭打ち。これより遠方の道路は取得されないため、極端に大きい `targetMeters`（例: 25km）では到達圏が取得範囲に収まらず候補品質が落ちうる。
- **OSM タイルは開発用途**: `map-style.ts` の OSM ラスタータイルは開発・デモ向け。本番は OSM タイル利用ポリシーに従い独自/商用タイルへ差し替える（描画層は抽象化済み）。
- **profile=walk と bike の差は「通行可否」と「一方通行」のみ**:
  - 通行可否: `walk` は `foot!=no`、`bike` は `bicycle!=no` かつ `steps|footway|pedestrian` を除外。
  - 一方通行: `walk` は全弧双方向（歩行者は `oneway` を無視）、`bike` は `oneway`/`oneway:bicycle`/`roundabout` を解釈し有向弧を張る。
  - 速度・所要時間・勾配などプロファイル別の重み付けは行わない（重みは常に haversine 距離）。
- **最近傍探索は線形走査**: `nearestNode` は全ノード走査。取得範囲が局所的で小さい前提に依存する。
- **経路結合の保険**: `walkLengthMeters`/`arcWeight` は弧が無い連続ノード間を haversine で補完する（通常は隣接ノードのみが連結されるため発生しない想定）。

---

## 9. 今後の拡張余地

- **目的の追加**: 標高（登坂回避）や緑地・景観などを `f3` 以降としてパレート最適化に追加。
- **所要時間目標**: 距離 `k` の代わりに、または併せて「所要時間」を目標とする（プロファイル別速度・勾配・信号などの重み付け）。
- **キャッシュ**: 同一地点・近傍の Overpass 取得結果やグラフのキャッシュ（現状はリクエストごとに毎回取得）。
- **CH 等の高速化**: 論文の contraction hierarchies など、より大きな目標距離・広域での高速化手法の導入。
- **プロファイル別エッジ重み**: 現状は全弧 haversine 距離。実走行コスト（坂・路面・交差点）を反映する重み。
- **自前タイル/エンドポイント**: 本番運用に向けた商用タイル・自前 Overpass の標準化。

---

### 参照ソース一覧

- `src/shared/types/round-trip.ts` — リクエスト/レスポンス型、Zod スキーマ、`profile`。
- `src/server/osm/overpass.ts` — Overpass クエリ、プロファイル別フィルタ、レート/エラー処理。
- `src/server/osm/build-graph.ts` — 有向グラフ構築、一方通行の扱い。
- `src/server/routing/geo.ts` — `haversineMeters`, `bearingDeg`, `destinationPoint`。
- `src/server/routing/graph.ts` — グラフ表現、無向エッジキー、`nearestNode`, `walkLengthMeters`。
- `src/server/routing/dijkstra.ts` — 二分ヒープ Dijkstra、ペナルティ、距離上限、遮断弧。
- `src/server/routing/isochrone.ts` — 到達圏（`0.6k`）Dijkstra。
- `src/server/routing/round-trip.ts` — 楕円多角形生成、レッグ経路化、再使用ペナルティ、out-and-back 除去、退化解棄却。
- `src/server/routing/walk.ts` — `f1`, `f2`、out-and-back 除去、パレート支配。
- `src/server/routing/pareto-local-search.ts` — Algorithm 3 & 4（残余グラフ + ダミー頂点 + BFS 木の近傍、アーカイブ）。
- `src/server/usecases/compute-round-trips.ts` — 全体オーケストレーション、取得半径、候補整形、多様性候補、推奨選択。
- `src/app/api/round-trip/route.ts` — API エンドポイント、バリデーション、エラーコード。
