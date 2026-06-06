import {
  neighbors,
  walkLengthMeters,
  type NodeId,
  type StreetGraph,
} from "@/server/routing/graph";

/** 距離キーの最小ヒープ。Dijkstra の優先度付きキュー。 */
class MinHeap {
  private heap: { node: NodeId; key: number }[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(node: NodeId, key: number): void {
    const h = this.heap;
    h.push({ node, key });
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (h[parent]!.key <= h[i]!.key) break;
      [h[parent], h[i]] = [h[i]!, h[parent]!];
      i = parent;
    }
  }

  pop(): { node: NodeId; key: number } | undefined {
    const h = this.heap;
    if (h.length === 0) return undefined;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      const n = h.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && h[l]!.key < h[smallest]!.key) smallest = l;
        if (r < n && h[r]!.key < h[smallest]!.key) smallest = r;
        if (smallest === i) break;
        [h[smallest], h[i]] = [h[i]!, h[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

export interface DijkstraOptions {
  /** この実距離（メートル）を超えたノードは探索しない（等時線用）。 */
  maxDistanceM?: number;
  /** このノードに到達したら打ち切る（単一目的地探索の高速化）。 */
  target?: NodeId;
  /** 既使用エッジ（無向キー）に乗算するペナルティ。重複回避用。 */
  penalizedEdgeKeys?: ReadonlySet<string>;
  penaltyFactor?: number;
  /** 遮断する有向弧 "from->to"。局所探索の残余グラフ用。 */
  blockedArcs?: ReadonlySet<string>;
}

export interface DijkstraResult {
  /** 各ノードへの実距離（ペナルティ抜き、メートル）。 */
  dist: Map<NodeId, number>;
  prev: Map<NodeId, NodeId>;
}

const directedKey = (from: NodeId, to: NodeId): string => `${from}->${to}`;

/**
 * source からの Dijkstra。
 * 優先度はペナルティ込みコストで決めるが、dist には実距離を記録する。
 * これにより「重複を避けつつも、長さの評価は実距離で行う」ことができる。
 */
export function dijkstra(
  graph: StreetGraph,
  source: NodeId,
  opts: DijkstraOptions = {},
): DijkstraResult {
  const dist = new Map<NodeId, number>();
  const prev = new Map<NodeId, NodeId>();
  const cost = new Map<NodeId, number>(); // ペナルティ込みの探索コスト
  const settled = new Set<NodeId>();
  const heap = new MinHeap();

  const penalty = opts.penaltyFactor ?? 5;
  const penalized = opts.penalizedEdgeKeys;
  const blocked = opts.blockedArcs;
  const maxD = opts.maxDistanceM ?? Infinity;

  dist.set(source, 0);
  cost.set(source, 0);
  heap.push(source, 0);

  while (heap.size > 0) {
    const top = heap.pop()!;
    const u = top.node;
    if (settled.has(u)) continue;
    settled.add(u);
    if (opts.target !== undefined && u === opts.target) break;

    const baseDist = dist.get(u)!;
    for (const arc of neighbors(graph, u)) {
      if (blocked && blocked.has(directedKey(u, arc.to))) continue;
      const realNext = baseDist + arc.weightM;
      if (realNext > maxD) continue;
      const stepCost =
        penalized && penalized.has(arc.edgeKey)
          ? arc.weightM * penalty
          : arc.weightM;
      const nextCost = (cost.get(u) ?? Infinity) + stepCost;
      if (nextCost < (cost.get(arc.to) ?? Infinity)) {
        cost.set(arc.to, nextCost);
        dist.set(arc.to, realNext);
        prev.set(arc.to, u);
        heap.push(arc.to, nextCost);
      }
    }
  }

  return { dist, prev };
}

/** prev マップから target までのノード列を復元する。 */
export function reconstructPath(
  prev: Map<NodeId, NodeId>,
  source: NodeId,
  target: NodeId,
): NodeId[] | null {
  if (source === target) return [source];
  const path: NodeId[] = [];
  let cur: NodeId | undefined = target;
  const guard = new Set<NodeId>();
  while (cur !== undefined) {
    if (guard.has(cur)) return null; // 循環防御
    guard.add(cur);
    path.push(cur);
    if (cur === source) {
      path.reverse();
      return path;
    }
    cur = prev.get(cur);
  }
  return null;
}

export interface ShortestPath {
  path: NodeId[];
  distanceM: number;
}

/**
 * source->target の最短経路（ペナルティ・遮断を考慮）。
 * 返す distanceM は実距離（ペナルティ抜き）。到達不能なら null。
 */
export function shortestPath(
  graph: StreetGraph,
  source: NodeId,
  target: NodeId,
  opts: Omit<DijkstraOptions, "target" | "maxDistanceM"> = {},
): ShortestPath | null {
  const { prev } = dijkstra(graph, source, { ...opts, target });
  const path = reconstructPath(prev, source, target);
  if (!path) return null;
  return { path, distanceM: walkLengthMeters(graph, path) };
}
