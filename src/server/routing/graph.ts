import { haversineMeters, type LatLng } from "@/server/routing/geo";

/**
 * 論文の有向・弧重み付きストリートグラフ G = (V, A, w)。
 * 頂点 = 交差点/端点、弧 = 道路セグメント、重み = メートル距離。
 *
 * 設計上の注意:
 * - ノード ID は OSM のノード ID（数値）をそのまま使う。
 * - f2（重複率）は「無向」エッジ単位で数えるため、各弧に無向キー edgeKey を持たせ、
 *   Dijkstra の再使用ペナルティと重複カウントの双方で同じキーを共有する。
 */

export type NodeId = number;

export interface Arc {
  to: NodeId;
  weightM: number;
  /** 無向エッジ識別キー（"小id_大id"）。重複・ペナルティ計算で共有。 */
  edgeKey: string;
}

export interface StreetGraph {
  nodes: Map<NodeId, LatLng>;
  adjacency: Map<NodeId, Arc[]>;
}

/** 無向エッジキー。方向に依らず同一区間を同じキーにする。 */
export function undirectedEdgeKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function createGraph(): StreetGraph {
  return { nodes: new Map(), adjacency: new Map() };
}

export function addNode(graph: StreetGraph, id: NodeId, pos: LatLng): void {
  if (!graph.nodes.has(id)) {
    graph.nodes.set(id, pos);
    graph.adjacency.set(id, []);
  }
}

/**
 * 有向弧を追加する。重みが未指定なら両端ノード座標から haversine で算出。
 * 既に同じ (from,to) があれば、より短い重みで上書きする（多重辺の正規化）。
 */
export function addArc(
  graph: StreetGraph,
  from: NodeId,
  to: NodeId,
  weightM?: number,
): void {
  const a = graph.nodes.get(from);
  const b = graph.nodes.get(to);
  if (a === undefined || b === undefined) {
    throw new Error(`addArc: missing node ${from} or ${to}`);
  }
  if (from === to) return;
  const w = weightM ?? haversineMeters(a, b);
  const list = graph.adjacency.get(from)!;
  const existing = list.find((arc) => arc.to === to);
  if (existing) {
    if (w < existing.weightM) existing.weightM = w;
    return;
  }
  list.push({ to, weightM: w, edgeKey: undirectedEdgeKey(from, to) });
}

export function neighbors(graph: StreetGraph, id: NodeId): Arc[] {
  return graph.adjacency.get(id) ?? [];
}

export function edgeCount(graph: StreetGraph): number {
  let n = 0;
  for (const arcs of graph.adjacency.values()) n += arcs.length;
  return n;
}

/** 指定座標に最も近いノード（線形走査）。グラフは局所的で小さいため十分高速。 */
export function nearestNode(graph: StreetGraph, pos: LatLng): NodeId | null {
  let best: NodeId | null = null;
  let bestDist = Infinity;
  for (const [id, p] of graph.nodes) {
    const d = haversineMeters(pos, p);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

/**
 * ノード列に沿った実距離（メートル）。
 * 連続ノード間に弧が無い場合は haversine で補完（経路結合時の保険）。
 */
export function walkLengthMeters(graph: StreetGraph, walk: NodeId[]): number {
  let total = 0;
  for (let i = 0; i + 1 < walk.length; i++) {
    total += arcWeight(graph, walk[i]!, walk[i + 1]!);
  }
  return total;
}

/** from->to の弧重み。弧が無ければ座標間 haversine。 */
export function arcWeight(graph: StreetGraph, from: NodeId, to: NodeId): number {
  const arc = neighbors(graph, from).find((a) => a.to === to);
  if (arc) return arc.weightM;
  const a = graph.nodes.get(from);
  const b = graph.nodes.get(to);
  if (a && b) return haversineMeters(a, b);
  return 0;
}
