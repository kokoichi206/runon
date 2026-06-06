import { dijkstra } from "@/server/routing/dijkstra";
import { bearingDeg } from "@/server/routing/geo";
import type { NodeId, StreetGraph } from "@/server/routing/graph";

export interface Reachable {
  /** source から実距離 maxDistanceM 以内に到達できるノードと距離。 */
  dist: Map<NodeId, number>;
  /** 最遠到達ノード（初期方位 β の決定に使う）。 */
  farthest: { node: NodeId; distanceM: number } | null;
  /** source -> 最遠ノードの方位（度）。 */
  baseBearingDeg: number;
}

/**
 * source から距離上限 maxDistanceM 以内の到達圏を計算する（論文の (k/2) 等時線に相当）。
 * グラフ上の実距離で判定するため、候補ウェイポイントの妥当性を正確に検査できる。
 */
export function computeReachable(
  graph: StreetGraph,
  source: NodeId,
  maxDistanceM: number,
): Reachable {
  const { dist } = dijkstra(graph, source, { maxDistanceM });

  let farthest: { node: NodeId; distanceM: number } | null = null;
  for (const [node, d] of dist) {
    if (node === source) continue;
    if (!farthest || d > farthest.distanceM) farthest = { node, distanceM: d };
  }

  let baseBearingDeg = 0;
  if (farthest) {
    const s = graph.nodes.get(source)!;
    const f = graph.nodes.get(farthest.node)!;
    baseBearingDeg = bearingDeg(s, f);
  }

  return { dist, farthest, baseBearingDeg };
}
