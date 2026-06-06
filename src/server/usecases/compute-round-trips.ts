import { buildGraphFromOverpass } from "@/server/osm/build-graph";
import {
  fetchStreetNetwork,
  type OverpassFetchResult,
} from "@/server/osm/overpass";
import type { LatLng } from "@/server/routing/geo";
import {
  edgeCount,
  type NodeId,
  type StreetGraph,
} from "@/server/routing/graph";
import { computeReachable } from "@/server/routing/isochrone";
import {
  paretoLocalSearch,
  type Solution,
} from "@/server/routing/pareto-local-search";
import {
  generatePolygons,
  refineRoute,
  routePolygon,
  snapStart,
} from "@/server/routing/round-trip";
import type { WalkMetrics } from "@/server/routing/walk";
import type {
  LngLat,
  RoundTripCandidate,
  RoundTripRequest,
  RoundTripResult,
} from "@/shared/types/round-trip";

const ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

export interface ComputeDeps {
  /** テスト/スモーク用に Overpass 取得を差し替え可能にする。 */
  fetchNetwork?: (
    center: LatLng,
    radiusM: number,
    profile: RoundTripRequest["profile"],
  ) => Promise<OverpassFetchResult>;
  overpassEndpoint?: string;
  userAgent?: string;
  signal?: AbortSignal;
  /** Stage2(局所探索) を実行するか。デフォルト true。 */
  enableLocalSearch?: boolean;
}

export class RoundTripError extends Error {}

function walkToLngLat(graph: StreetGraph, walk: NodeId[]): LngLat[] {
  const out: LngLat[] = [];
  for (const id of walk) {
    const p = graph.nodes.get(id);
    if (p) out.push([p.lng, p.lat]);
  }
  return out;
}

/** 取得半径。目標距離の片道分 ~k/2 に余裕を持たせ、公開 Overpass 保護のため上限を設ける。 */
function fetchRadiusMeters(targetMeters: number): number {
  return Math.min(15_000, Math.round(targetMeters * 0.6 + 200));
}

const score = (m: WalkMetrics, k: number): number =>
  m.lengthError / k + m.overlapPercent / 100;

export async function computeRoundTrips(
  req: RoundTripRequest,
  deps: ComputeDeps = {},
): Promise<RoundTripResult> {
  const computeStart = Date.now();
  const center: LatLng = { lat: req.lat, lng: req.lng };
  const radius = fetchRadiusMeters(req.targetMeters);

  const fetcher =
    deps.fetchNetwork ??
    ((c, r, p) =>
      fetchStreetNetwork(c, r, p, {
        endpoint: deps.overpassEndpoint,
        userAgent: deps.userAgent,
        signal: deps.signal,
      }));

  const { ways, fetchMs } = await fetcher(center, radius, req.profile);
  if (ways.length === 0) {
    throw new RoundTripError(
      "この地点の周辺に対象の道路が見つかりませんでした。場所やプロファイルを変えてください。",
    );
  }

  const graph = buildGraphFromOverpass(ways, req.profile);
  const startNode = snapStart(graph, center, 400);
  if (startNode === null) {
    throw new RoundTripError(
      "指定地点の近くに道路ノードがありません。道路に近い地点を選んでください。",
    );
  }
  const startPos = graph.nodes.get(startNode)!;

  // 到達圏 (~k/2、少し余裕)。
  const reachable = computeReachable(graph, startNode, req.targetMeters * 0.6);
  if (reachable.dist.size < 5) {
    throw new RoundTripError(
      "周辺の道路網が疎すぎて周回経路を作れません。距離を伸ばすか別の地点を試してください。",
    );
  }

  // Stage 1: 等時線多角形法 + detour 補正。
  // 直線周長で多角形を作ると、道路でのレッグ接続により実距離が伸びる（detour）。
  // (1) 少数の多角形で「実距離/周長」の中央値を実測し、
  // (2) 周長を k/detour に縮めて本生成、(3) 各候補を再スケールで k に寄せる。
  const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const median = (xs: number[]): number => {
    if (xs.length === 0) return 1.3;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  const probePolys = generatePolygons(startPos, req.targetMeters, reachable.baseBearingDeg, {
    bearingCount: 4,
    aspects: [[1, 1]],
    vertexCounts: [4],
  });
  const ratios: number[] = [];
  for (const p of probePolys) {
    const r = routePolygon(graph, startNode, p, req.targetMeters, reachable, 5);
    if (r) ratios.push(r.metrics.lengthMeters / req.targetMeters);
  }
  const detour = clampN(median(ratios), 1.0, 2.2);

  const polygons = generatePolygons(
    startPos,
    req.targetMeters / detour,
    reachable.baseBearingDeg,
  );

  const stage1: {
    sol: Solution;
    waypointNodes: NodeId[];
    bearingDeg: number;
  }[] = [];
  for (const polygon of polygons) {
    const routed = refineRoute(
      graph,
      startNode,
      startPos,
      polygon,
      req.targetMeters,
      reachable,
      5,
      2,
      0.06,
    );
    if (routed) {
      stage1.push({
        sol: { walk: routed.walk, metrics: routed.metrics },
        waypointNodes: routed.waypointNodes,
        bearingDeg: routed.polygon.bearingDeg,
      });
    }
  }

  if (stage1.length === 0) {
    throw new RoundTripError(
      "周回経路の候補を生成できませんでした。距離やプロファイルを変えて再試行してください。",
    );
  }

  const sigOf = (m: WalkMetrics): string =>
    `${Math.round(m.lengthMeters)}:${Math.round(m.overlapPercent * 10)}`;
  const stage1Signatures = new Map<string, NodeId[]>();
  for (const s of stage1) stage1Signatures.set(sigOf(s.sol.metrics), s.waypointNodes);

  // Stage 2: パレート局所探索。
  const initial = stage1.map((s) => s.sol);
  const front =
    deps.enableLocalSearch === false
      ? initial
      : paretoLocalSearch(graph, startNode, req.targetMeters, initial, {
          maxIterations: 250,
          maxArchive: 40,
          timeBudgetMs: 5000,
        });

  // 最適解 (f1≈0,f2≈0) はほぼ全候補を支配しフロントが小さくなるため、
  // 方位の異なる Stage-1 ループを「多様性候補」として併せて提示する。
  // フロント解は onParetoFront=true、多様性候補は false で明示区別する。
  const byScore = (a: Solution, b: Solution) =>
    score(a.metrics, req.targetMeters) - score(b.metrics, req.targetMeters);
  const frontSorted = [...front].sort(byScore);
  const frontSigs = new Set(frontSorted.map((s) => sigOf(s.metrics)));

  // 45°バケットごとに、目標距離に最も近い Stage-1 候補を 1 つ残す。
  // 目標から ±DIVERSE_TOL を超える候補は「別方向」としても出さない（overshoot 防止）。
  const DIVERSE_TOL = 0.1; // ±10%
  const diverse = new Map<number, (typeof stage1)[number]>();
  for (const e of stage1) {
    if (e.sol.metrics.lengthError / req.targetMeters > DIVERSE_TOL) continue;
    const bucket = Math.floor((((e.bearingDeg % 360) + 360) % 360) / 45);
    const cur = diverse.get(bucket);
    if (!cur || e.sol.metrics.lengthError < cur.sol.metrics.lengthError) {
      diverse.set(bucket, e);
    }
  }

  type Entry = { sol: Solution; onFront: boolean };
  const combined: Entry[] = frontSorted.map((sol) => ({ sol, onFront: true }));
  const seen = new Set(frontSigs);
  for (const e of [...diverse.values()].sort((a, b) => byScore(a.sol, b.sol))) {
    const sig = sigOf(e.sol.metrics);
    if (seen.has(sig)) continue;
    seen.add(sig);
    combined.push({ sol: e.sol, onFront: false });
  }

  const recommendedSig =
    frontSorted.length > 0 ? sigOf(frontSorted[0]!.metrics) : null;
  const limited = combined.slice(0, 8);

  let recommendedId = "";
  const candidates: RoundTripCandidate[] = limited.map((entry, idx) => {
    const sig = sigOf(entry.sol.metrics);
    const wpNodes = stage1Signatures.get(sig);
    const source: RoundTripCandidate["source"] = wpNodes
      ? "isochrone-polygon"
      : "pareto-local-search";
    const waypoints: LngLat[] = wpNodes
      ? wpNodes
          .map((id) => graph.nodes.get(id))
          .filter((p): p is LatLng => p !== undefined)
          .map((p) => [p.lng, p.lat])
      : [[startPos.lng, startPos.lat]];
    const id = `cand-${idx}`;
    if (recommendedId === "" && entry.onFront && sig === recommendedSig) {
      recommendedId = id;
    }
    return {
      id,
      path: walkToLngLat(graph, entry.sol.walk),
      waypoints,
      lengthMeters: Math.round(entry.sol.metrics.lengthMeters),
      lengthError: Math.round(entry.sol.metrics.lengthError),
      overlapPercent: Math.round(entry.sol.metrics.overlapPercent * 10) / 10,
      onParetoFront: entry.onFront,
      source,
    };
  });

  if (recommendedId === "") recommendedId = candidates[0]?.id ?? "";

  return {
    start: [startPos.lng, startPos.lat],
    recommendedId,
    candidates,
    stats: {
      graphNodes: graph.nodes.size,
      graphEdges: edgeCount(graph),
      reachableNodes: reachable.dist.size,
      computeMs: Date.now() - computeStart,
      overpassMs: fetchMs,
    },
    attribution: ATTRIBUTION,
  };
}
