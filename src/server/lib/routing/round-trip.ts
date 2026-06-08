import { shortestPath } from "@/server/lib/routing/dijkstra";
import { destinationPoint, haversineMeters, type LatLng } from "@/server/lib/routing/geo";
import {
  nearestNode,
  undirectedEdgeKey,
  type NodeId,
  type StreetGraph,
} from "@/server/lib/routing/graph";
import type { Reachable } from "@/server/lib/routing/isochrone";
import { evaluateWalk, removeOutAndBack, type WalkMetrics } from "@/server/lib/routing/walk";

export interface PolygonSpec {
  /**
   * 頂点列（vertices[0] は始点 start と一致）。
   */
  vertices: LatLng[];
  bearingDeg: number;
  /**
   * 楕円の縦横比メタ（デバッグ用）。
   */
  aspect: { along: number; across: number };
}

export interface GenerateOptions {
  /**
   * 多角形の頂点数 n（始点含む）。論文の例は n=4。
   */
  vertexCounts?: number[];
  /**
   * 方位スイープの本数。
   */
  bearingCount?: number;
  /**
   * 楕円アスペクト比 [along(β方向), across(直交)] のリスト。
   */
  aspects?: [number, number][];
  /**
   * 既使用エッジへの再使用ペナルティ係数。
   */
  penaltyFactor?: number;
}

const DEFAULTS: Required<GenerateOptions> = {
  vertexCounts: [4],
  bearingCount: 8,
  aspects: [
    [1, 1],
    [1.5, 0.7],
    [0.7, 1.3],
  ],
  penaltyFactor: 5,
};

/**
 * 始点を頂点0に固定した楕円多角形を生成する。
 * ローカル平面（forward=β方向 u, perp=直交 v）で楕円上に n 頂点を置き、
 * 実際の辺長合計が目標周長 k になるよう一様スケールする。
 */
export const buildPolygon = (
  start: LatLng,
  targetMeters: number,
  bearing: number,
  n: number,
  aspect: [number, number]
): PolygonSpec => {
  const [alongRaw, acrossRaw] = aspect;
  // φ_0 = π としたとき頂点0が楕円の「後端」= start に来る。
  const phi0 = Math.PI;
  const localOffsets: { east: number; north: number }[] = [];
  const br = (bearing * Math.PI) / 180;
  // 単位ベクトル u(forward, β方向) と v(perp)
  const uEast = Math.sin(br);
  const uNorth = Math.cos(br);
  const vEast = Math.cos(br);
  const vNorth = -Math.sin(br);

  // 仮の半径（後でスケール）。
  const baseR = 1000;
  const A = baseR * alongRaw;
  const B = baseR * acrossRaw;

  for (let i = 0; i < n; i++) {
    const phi = phi0 + (i * 2 * Math.PI) / n;
    // center_local = A*u（forward 方向）, vertex_i = center + A cosφ u + B sinφ v
    const f = A + A * Math.cos(phi); // forward 成分
    const p = B * Math.sin(phi); // perp 成分
    const east = f * uEast + p * vEast;
    const north = f * uNorth + p * vNorth;
    localOffsets.push({ east, north });
  }

  // 仮スケールでの周長を算出して目標 k にスケール。
  let perim = 0;
  for (let i = 0; i < n; i++) {
    const a = localOffsets[i]!;
    const b = localOffsets[(i + 1) % n]!;
    perim += Math.hypot(a.east - b.east, a.north - b.north);
  }
  const scale = perim > 0 ? targetMeters / perim : 1;

  const vertices: LatLng[] = localOffsets.map(({ east, north }) => {
    const e = east * scale;
    const ndir = north * scale;
    const dist = Math.hypot(e, ndir);
    if (dist < 1e-6) return { ...start };
    const b = (Math.atan2(e, ndir) * 180) / Math.PI;
    return destinationPoint(start, dist, (b + 360) % 360);
  });

  return { vertices, bearingDeg: bearing, aspect: { along: alongRaw, across: acrossRaw } };
};

/**
 * 多方位・多アスペクト・多 n の多角形候補を生成。
 */
export const generatePolygons = (
  start: LatLng,
  targetMeters: number,
  baseBearingDeg: number,
  options: GenerateOptions = {}
): PolygonSpec[] => {
  const opts = { ...DEFAULTS, ...options };
  const polygons: PolygonSpec[] = [];
  const step = 360 / opts.bearingCount;
  for (let b = 0; b < opts.bearingCount; b++) {
    const bearing = (baseBearingDeg + b * step) % 360;
    for (const n of opts.vertexCounts) {
      for (const aspect of opts.aspects) {
        polygons.push(buildPolygon(start, targetMeters, bearing, n, aspect));
      }
    }
  }
  return polygons;
};

export interface RoutedCandidate {
  walk: NodeId[];
  waypointNodes: NodeId[];
  polygon: PolygonSpec;
  metrics: WalkMetrics;
}

/**
 * 1 つの多角形を実際の周回経路へ変換する（論文 Stage 1）。
 * - 各頂点を最近傍ノードへスナップ
 * - レッグを順に Dijkstra で接続。既使用エッジにはペナルティを与え重複を抑制
 * - 結合した閉路に out-and-back 除去を適用し (f1,f2) を評価
 * 経路が繋がらない、または退化した場合は null。
 */
export const routePolygon = (
  graph: StreetGraph,
  startNode: NodeId,
  polygon: PolygonSpec,
  targetMeters: number,
  reachable: Reachable,
  penaltyFactor: number
): RoutedCandidate | null => {
  // 頂点をノードへスナップ（vertices[0]=start は startNode 固定）。
  const snapped: NodeId[] = [startNode];
  for (let i = 1; i < polygon.vertices.length; i++) {
    const node = nearestNode(graph, polygon.vertices[i]!);
    if (node === null) return null;
    // 到達圏外（k/2 から大きく外れる）の頂点は質が落ちるため棄却。
    if (!reachable.dist.has(node)) return null;
    snapped.push(node);
  }

  // ノード列（始点に戻る）を作り、連続重複を除去。
  const sequence: NodeId[] = [];
  for (const node of [...snapped, startNode]) {
    if (sequence.length === 0 || sequence[sequence.length - 1] !== node) {
      sequence.push(node);
    }
  }
  if (sequence.length < 3) return null; // start->X->start にもならない

  const usedEdgeKeys = new Set<string>();
  const walk: NodeId[] = [sequence[0]!];

  for (let i = 0; i + 1 < sequence.length; i++) {
    const from = sequence[i]!;
    const to = sequence[i + 1]!;
    const leg = shortestPath(graph, from, to, {
      penalizedEdgeKeys: usedEdgeKeys,
      penaltyFactor,
    });
    if (!leg || leg.path.length < 2) return null;
    for (let j = 1; j < leg.path.length; j++) {
      walk.push(leg.path[j]!);
      usedEdgeKeys.add(undirectedEdgeKey(leg.path[j - 1]!, leg.path[j]!));
    }
  }

  // 始点に戻る閉路であることを保証。
  if (walk[walk.length - 1] !== startNode) return null;

  const trimmed = removeOutAndBack(walk, startNode);
  if (trimmed.length < 3) return null;

  const metrics = evaluateWalk(graph, trimmed, targetMeters);
  // 極端に短い/長い退化解（目標の 30%未満 or 300%超）は棄却。
  if (metrics.lengthMeters < targetMeters * 0.3 || metrics.lengthMeters > targetMeters * 3) {
    return null;
  }

  return {
    walk: trimmed,
    waypointNodes: snapped,
    polygon,
    metrics,
  };
};

/**
 * 多角形の直線距離の周長（メートル）。
 */
export const polygonPerimeterMeters = (polygon: PolygonSpec): number => {
  const v = polygon.vertices;
  let p = 0;
  for (let i = 0; i < v.length; i++) {
    p += haversineMeters(v[i]!, v[(i + 1) % v.length]!);
  }
  return p;
};

/**
 * 多角形をルート化し、実距離が目標から外れていれば
 * 「周長 × (目標/実距離)」で多角形を再スケールして再ルートする（論文 Stage 3 の回帰補正を簡略化）。
 * 既に許容範囲内なら追加ルートはしない。
 */
export const refineRoute = (
  graph: StreetGraph,
  startNode: NodeId,
  start: LatLng,
  polygon: PolygonSpec,
  targetMeters: number,
  reachable: Reachable,
  penaltyFactor: number,
  maxIters = 2,
  tolerance = 0.06
): RoutedCandidate | null => {
  let best = routePolygon(graph, startNode, polygon, targetMeters, reachable, penaltyFactor);
  for (let i = 0; i < maxIters && best; i++) {
    const len = best.metrics.lengthMeters;
    if (Math.abs(len - targetMeters) / targetMeters <= tolerance) break;
    const perim = polygonPerimeterMeters(best.polygon);
    const newPerim = perim * (targetMeters / len);
    const n = best.polygon.vertices.length;
    const { along, across } = best.polygon.aspect;
    const candidate = buildPolygon(start, newPerim, best.polygon.bearingDeg, n, [along, across]);
    const routed = routePolygon(
      graph,
      startNode,
      candidate,
      targetMeters,
      reachable,
      penaltyFactor
    );
    if (!routed) break;
    // 改善した場合のみ採用。
    if (Math.abs(routed.metrics.lengthMeters - targetMeters) < Math.abs(len - targetMeters)) {
      best = routed;
    } else {
      break;
    }
  }
  return best;
};

/**
 * start に最も近いノードを返す（snap）。距離が遠すぎる場合は null。
 */
export const snapStart = (
  graph: StreetGraph,
  start: LatLng,
  maxSnapMeters = 500,
  allowed?: Set<NodeId>
): NodeId | null => {
  const node = nearestNode(graph, start, allowed);
  if (node === null) return null;
  const d = haversineMeters(start, graph.nodes.get(node)!);
  return d <= maxSnapMeters ? node : null;
};
