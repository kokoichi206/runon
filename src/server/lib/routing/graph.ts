import { haversineMeters, type LatLng } from "@/server/lib/routing/geo";

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
  /**
   * 無向エッジ識別キー（"小id_大id"）。重複・ペナルティ計算で共有。
   */
  edgeKey: string;
}

export interface StreetGraph {
  nodes: Map<NodeId, LatLng>;
  adjacency: Map<NodeId, Arc[]>;
}

/**
 * 無向エッジキー。方向に依らず同一区間を同じキーにする。
 */
export const undirectedEdgeKey = (a: NodeId, b: NodeId): string => {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
};

export const createGraph = (): StreetGraph => {
  return { nodes: new Map(), adjacency: new Map() };
};

export const addNode = (graph: StreetGraph, id: NodeId, pos: LatLng): void => {
  if (!graph.nodes.has(id)) {
    graph.nodes.set(id, pos);
    graph.adjacency.set(id, []);
  }
};

/**
 * 有向弧を追加する。重みが未指定なら両端ノード座標から haversine で算出。
 * 既に同じ (from,to) があれば、より短い重みで上書きする（多重辺の正規化）。
 */
export const addArc = (
  graph: StreetGraph,
  from: NodeId,
  to: NodeId,
  weightM?: number,
): void => {
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
};

export const neighbors = (graph: StreetGraph, id: NodeId): Arc[] => {
  return graph.adjacency.get(id) ?? [];
};

export const edgeCount = (graph: StreetGraph): number => {
  let n = 0;
  for (const arcs of graph.adjacency.values()) n += arcs.length;
  return n;
};

/**
 * 指定座標に最も近いノード（線形走査）。グラフは局所的で小さいため十分高速。
 * allowed を渡すとその集合内のノードのみを対象にする（例: 最大連結成分への再スナップ）。
 */
export const nearestNode = (
  graph: StreetGraph,
  pos: LatLng,
  allowed?: Set<NodeId>,
): NodeId | null => {
  let best: NodeId | null = null;
  let bestDist = Infinity;
  for (const [id, p] of graph.nodes) {
    if (allowed && !allowed.has(id)) continue;
    const d = haversineMeters(pos, p);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
};

/**
 * 弧の向きを無視した連結成分のうち最大のものを返す。
 * 始点が切り離された小成分（海沿いの遊歩道断片など）へ誤スナップするのを避けるために使う。
 */
export const largestComponent = (graph: StreetGraph): Set<NodeId> => {
  const undirected = new Map<NodeId, NodeId[]>();
  const link = (a: NodeId, b: NodeId): void => {
    let l = undirected.get(a);
    if (l === undefined) {
      l = [];
      undirected.set(a, l);
    }
    l.push(b);
  };
  for (const [from, arcs] of graph.adjacency) {
    for (const arc of arcs) {
      link(from, arc.to);
      link(arc.to, from);
    }
  }

  const seen = new Set<NodeId>();
  let best = new Set<NodeId>();
  for (const startId of graph.nodes.keys()) {
    if (seen.has(startId)) continue;
    const comp = new Set<NodeId>([startId]);
    const queue: NodeId[] = [startId];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++]!;
      for (const v of undirected.get(u) ?? []) {
        if (!comp.has(v)) {
          comp.add(v);
          queue.push(v);
        }
      }
    }
    for (const n of comp) seen.add(n);
    if (comp.size > best.size) best = comp;
  }
  return best;
};

/**
 * ノード列に沿った実距離（メートル）。
 * 連続ノード間に弧が無い場合は haversine で補完（経路結合時の保険）。
 */
export const walkLengthMeters = (graph: StreetGraph, walk: NodeId[]): number => {
  let total = 0;
  for (let i = 0; i + 1 < walk.length; i++) {
    total += arcWeight(graph, walk[i]!, walk[i + 1]!);
  }
  return total;
};

/**
 * from->to の弧重み。弧が無ければ座標間 haversine。
 */
export const arcWeight = (graph: StreetGraph, from: NodeId, to: NodeId): number => {
  const arc = neighbors(graph, from).find((a) => a.to === to);
  if (arc) return arc.weightM;
  const a = graph.nodes.get(from);
  const b = graph.nodes.get(to);
  if (a && b) return haversineMeters(a, b);
  return 0;
};
