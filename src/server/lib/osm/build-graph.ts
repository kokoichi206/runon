import { haversineMeters } from "@/server/lib/routing/geo";
import { addArc, addNode, type StreetGraph } from "@/server/lib/routing/graph";
import { createGraph } from "@/server/lib/routing/graph";
import type { OverpassWay } from "@/shared/types/round-trip";
import type { Profile } from "@/shared/types/round-trip";

type Direction = "both" | "forward" | "reverse";

/**
 * 自転車プロファイルの一方通行解釈。徒歩は常に双方向。
 */
const travelDirection = (tags: Record<string, string> | undefined): Direction => {
  if (!tags) return "both";
  let dir: Direction = "both";
  const ow = tags["oneway"];
  if (ow === "yes" || ow === "true" || ow === "1") dir = "forward";
  else if (ow === "-1" || ow === "reverse") dir = "reverse";

  if ((tags["junction"] === "roundabout" || tags["junction"] === "circular") && dir === "both") {
    dir = "forward";
  }

  // 自転車専用の上書き。
  const owb = tags["oneway:bicycle"];
  if (owb === "no") dir = "both";
  else if (owb === "yes") dir = "forward";

  return dir;
};

/**
 * Overpass の way 群から有向ストリートグラフを構築する。
 * 連続ノード間にセグメント弧を張り、共有ノード ID が交差点トポロジを与える。
 */
export const buildGraphFromOverpass = (
  ways: OverpassWay[],
  profile: Profile,
  signalNodeIds?: ReadonlySet<number>
): StreetGraph => {
  const graph = createGraph();

  for (const way of ways) {
    const ids = way.nodes;
    const geom = way.geometry;
    if (!ids || !geom || ids.length !== geom.length || ids.length < 2) continue;

    const dir = profile === "walk" ? "both" : travelDirection(way.tags);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const g = geom[i]!;
      addNode(graph, id, { lat: g.lat, lng: g.lon });
    }

    for (let i = 0; i + 1 < ids.length; i++) {
      const a = ids[i]!;
      const b = ids[i + 1]!;
      if (a === b) continue;
      const ga = geom[i]!;
      const gb = geom[i + 1]!;
      // 重みは隣接ジオメトリ間の haversine。両方向で同じ値。
      const weightM = haversineMeters({ lat: ga.lat, lng: ga.lon }, { lat: gb.lat, lng: gb.lon });
      if (dir === "both" || dir === "forward") addArc(graph, a, b, weightM);
      if (dir === "both" || dir === "reverse") addArc(graph, b, a, weightM);
    }
  }

  // 信号ノードのうち、実際にグラフ上に存在するものだけを記録する。
  if (signalNodeIds) {
    for (const id of signalNodeIds) {
      if (graph.nodes.has(id)) graph.signalNodes.add(id);
    }
  }

  return graph;
};
