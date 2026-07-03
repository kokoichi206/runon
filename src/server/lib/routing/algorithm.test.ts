import { describe, expect, it } from "vitest";

import { buildGraphFromOverpass } from "@/server/lib/osm/build-graph";
import { shortestPath } from "@/server/lib/routing/dijkstra";
import {
  bearingDeg,
  destinationPoint,
  haversineMeters,
  type LatLng,
} from "@/server/lib/routing/geo";
import { undirectedEdgeKey } from "@/server/lib/routing/graph";
import { computeReachable } from "@/server/lib/routing/isochrone";
import { generateNeighbors } from "@/server/lib/routing/pareto-local-search";
import { generatePolygons, routePolygon, snapStart } from "@/server/lib/routing/round-trip";
import {
  countNarrowSegments,
  dominates,
  evaluateWalk,
  removeOutAndBack,
} from "@/server/lib/routing/walk";
import { computeRoundTrips } from "@/server/usecases/compute-round-trips";
import type { OverpassWay } from "@/shared/types/round-trip";

// 50m 間隔の格子状ストリートを Overpass way 群として合成する。
const gridWays = (rows: number, cols: number, spacingM: number, origin: LatLng): OverpassWay[] => {
  const dLat = spacingM / 111_320;
  const dLng = spacingM / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const nodeId = (r: number, c: number) => 1000 + r * cols + c;
  const coord = (r: number, c: number) => ({
    lat: origin.lat + r * dLat,
    lon: origin.lng + c * dLng,
  });

  const ways: OverpassWay[] = [];
  // 横方向の道
  for (let r = 0; r < rows; r++) {
    const ids: number[] = [];
    const geometry: {
      lat: number;
      lon: number;
    }[] = [];
    for (let c = 0; c < cols; c++) {
      ids.push(nodeId(r, c));
      geometry.push(coord(r, c));
    }
    ways.push({
      type: "way",
      id: 1_000_000 + r,
      nodes: ids,
      geometry,
      tags: {
        highway: "residential",
      },
    });
  }
  // 縦方向の道
  for (let c = 0; c < cols; c++) {
    const ids: number[] = [];
    const geometry: {
      lat: number;
      lon: number;
    }[] = [];
    for (let r = 0; r < rows; r++) {
      ids.push(nodeId(r, c));
      geometry.push(coord(r, c));
    }
    ways.push({
      type: "way",
      id: 2_000_000 + c,
      nodes: ids,
      geometry,
      tags: {
        highway: "residential",
      },
    });
  }
  return ways;
};

const ORIGIN: LatLng = {
  lat: 35.0,
  lng: 139.0,
};

describe("geo", () => {
  it("haversine は概ね正しい距離を返す", () => {
    const a: LatLng = {
      lat: 35,
      lng: 139,
    };
    const b = destinationPoint(a, 1000, 90);
    expect(haversineMeters(a, b)).toBeCloseTo(1000, 0);
  });

  it("bearing は東向きで ~90度", () => {
    const a: LatLng = {
      lat: 35,
      lng: 139,
    };
    const b = destinationPoint(a, 500, 90);
    expect(bearingDeg(a, b)).toBeGreaterThan(89);
    expect(bearingDeg(a, b)).toBeLessThan(91);
  });
});

describe("grid graph + dijkstra", () => {
  const ways = gridWays(11, 11, 50, ORIGIN);
  const graph = buildGraphFromOverpass(ways, "walk");

  it("ノード数とエッジ数が格子に一致", () => {
    expect(graph.nodes.size).toBe(121);
    // 各内部接続は双方向。横: 11*10*2, 縦: 11*10*2 = 440
    let edges = 0;
    for (const arcs of graph.adjacency.values()) edges += arcs.length;
    expect(edges).toBe(440);
  });

  it("最短経路距離は格子のマンハッタン距離に一致", () => {
    const from = 1000; // (0,0)
    const to = 1000 + 10 * 11 + 10; // (10,10)
    const sp = shortestPath(graph, from, to);
    expect(sp).not.toBeNull();
    // 20 辺 * 50m = 1000m
    expect(sp!.distanceM).toBeCloseTo(1000, -1);
  });

  it("到達圏は距離上限で制限される", () => {
    const r = computeReachable(graph, 1000 + 5 * 11 + 5, 150);
    // 150m = 3辺ぶん。中心から 3 辺以内のノードのみ。
    expect(r.dist.size).toBeGreaterThan(5);
    for (const d of r.dist.values()) expect(d).toBeLessThanOrEqual(150 + 1e-6);
  });
});

describe("walk metrics", () => {
  const ways = gridWays(11, 11, 50, ORIGIN);
  const graph = buildGraphFromOverpass(ways, "walk");

  it("removeOutAndBack はネストした行き止まりを畳み込む", () => {
    // A,B,C,B,A -> A
    const walk = [1, 2, 3, 2, 1];
    expect(removeOutAndBack(walk, 1)).toEqual([1]);
  });

  it("removeOutAndBack は正当な周回を保つ", () => {
    // 正方形ループ (0,0)->(0,1)->(1,1)->(1,0)->(0,0)
    const a = 1000,
      b = 1001,
      c = 1000 + 11 + 1,
      d = 1000 + 11;
    const loop = [a, b, c, d, a];
    expect(removeOutAndBack(loop, a)).toEqual(loop);
  });

  it("evaluateWalk は out-and-back の重複率を計上", () => {
    const a = 1000,
      b = 1001,
      c = 1002;
    // a->b->c->b->a: bc, cb は同一無向辺の再通過、ab も
    const m = evaluateWalk(graph, [a, b, c, b, a], 200);
    expect(m.lengthMeters).toBeCloseTo(200, -1);
    expect(m.overlapPercent).toBeGreaterThan(0);
  });

  it("dominates は (f1,f2) のパレート支配", () => {
    expect(
      dominates(
        {
          lengthMeters: 0,
          lengthError: 10,
          overlapPercent: 5,
        },
        {
          lengthMeters: 0,
          lengthError: 20,
          overlapPercent: 5,
        }
      )
    ).toBe(true);
    expect(
      dominates(
        {
          lengthMeters: 0,
          lengthError: 10,
          overlapPercent: 5,
        },
        {
          lengthMeters: 0,
          lengthError: 10,
          overlapPercent: 5,
        }
      )
    ).toBe(false);
  });
});

describe("細道回避（narrow road avoidance）", () => {
  // メートルオフセットを度に変換するヘルパー（ORIGIN 基準）。
  const mLat = (m: number) => m / 111_320;
  const mLng = (m: number) => m / (111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
  // A(1) と B(2) を結ぶ2経路:
  // - 細い service（路地）で直進 100m（A->B）
  // - 広い residential で迂回 ~160m（A->M->N->B）
  const A = 1,
    B = 2,
    M = 3,
    N = 4;
  const node = (eastM: number, northM: number) => ({
    lat: ORIGIN.lat + mLat(northM),
    lon: ORIGIN.lng + mLng(eastM),
  });
  const coords = new Map<number, {
    lat: number;
    lon: number;
  }>([
    [A, node(0, 0)],
    [B, node(100, 0)],
    [M, node(0, 30)],
    [N, node(100, 30)],
  ]);
  const wayOf = (id: number, ids: number[], highway: string): OverpassWay => ({
    type: "way",
    id,
    nodes: ids,
    geometry: ids.map((n) => coords.get(n)!),
    tags: {
      highway,
    },
  });
  const ways: OverpassWay[] = [
    wayOf(10, [A, B], "service"), // 細道（直進）
    wayOf(11, [A, M, N, B], "residential"), // 広い道（迂回）
  ];
  const graph = buildGraphFromOverpass(ways, "walk");

  it("service のエッジが narrowEdges に登録される", () => {
    expect(graph.narrowEdges.has(undirectedEdgeKey(A, B))).toBe(true);
    // residential の迂回辺は細道ではない。
    expect(graph.narrowEdges.has(undirectedEdgeKey(A, M))).toBe(false);
  });

  it("footway は細道扱いしない（幹線沿い歩道などを誤爆しない）", () => {
    const fw = buildGraphFromOverpass([wayOf(20, [A, B], "footway")], "walk");
    expect(fw.narrowEdges.has(undirectedEdgeKey(A, B))).toBe(false);
  });

  it("ペナルティ無しなら細道で直進する", () => {
    const sp = shortestPath(graph, A, B);
    expect(sp).not.toBeNull();
    expect(sp!.path).toEqual([A, B]);
    expect(countNarrowSegments(graph, sp!.path)).toBe(1);
  });

  it("ペナルティ係数を与えると広い道へ迂回する", () => {
    const sp = shortestPath(graph, A, B, {
      narrowPenaltyFactor: 3,
    });
    expect(sp).not.toBeNull();
    expect(sp!.path).toEqual([A, M, N, B]);
    // 返す distanceM は実距離（ペナルティ抜き）。
    expect(sp!.distanceM).toBeCloseTo(160, -1);
    expect(countNarrowSegments(graph, sp!.path)).toBe(0);
  });
});

describe("polygon + routePolygon", () => {
  const ways = gridWays(31, 31, 50, ORIGIN); // 1.5km 四方
  const graph = buildGraphFromOverpass(ways, "walk");
  const center = {
    lat: ORIGIN.lat + 15 * (50 / 111320),
    lng: ORIGIN.lng + 15 * (50 / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180))),
  };

  it("生成多角形の頂点0は始点に一致", () => {
    const polys = generatePolygons(center, 800, 0);
    expect(polys.length).toBeGreaterThan(0);
    for (const p of polys) {
      expect(haversineMeters(p.vertices[0]!, center)).toBeLessThan(1);
    }
  });

  it("routePolygon は始点に戻る閉路を生成する", () => {
    const startNode = snapStart(graph, center, 100)!;
    expect(startNode).not.toBeNull();
    const reachable = computeReachable(graph, startNode, 800 * 0.6);
    const polys = generatePolygons(graph.nodes.get(startNode)!, 800, reachable.baseBearingDeg);
    let found = 0;
    for (const p of polys) {
      const routed = routePolygon(graph, startNode, p, 800, reachable, 5);
      if (routed) {
        found++;
        expect(routed.walk[0]).toBe(startNode);
        expect(routed.walk[routed.walk.length - 1]).toBe(startNode);
        // 連続ノードは隣接している
        for (let i = 0; i + 1 < routed.walk.length; i++) {
          const arcs = graph.adjacency.get(routed.walk[i]!)!;
          expect(arcs.some((a) => a.to === routed.walk[i + 1])).toBe(true);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("generateNeighbors", () => {
  const ways = gridWays(31, 31, 50, ORIGIN);
  const graph = buildGraphFromOverpass(ways, "walk");
  const center = {
    lat: ORIGIN.lat + 15 * (50 / 111320),
    lng: ORIGIN.lng + 15 * (50 / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180))),
  };

  it("近傍は始点に戻る妥当な歩行のみ", () => {
    const startNode = snapStart(graph, center, 100)!;
    const reachable = computeReachable(graph, startNode, 800 * 0.6);
    const polys = generatePolygons(graph.nodes.get(startNode)!, 800, reachable.baseBearingDeg);
    let base = null;
    for (const p of polys) {
      const r = routePolygon(graph, startNode, p, 800, reachable, 5);
      if (r) {
        base = r;
        break;
      }
    }
    expect(base).not.toBeNull();
    const neighbors = generateNeighbors(graph, base!.walk, startNode, 800);
    expect(neighbors.length).toBeGreaterThan(0);
    for (const nb of neighbors) {
      expect(nb.walk[0]).toBe(startNode);
      expect(nb.walk[nb.walk.length - 1]).toBe(startNode);
      for (let i = 0; i + 1 < nb.walk.length; i++) {
        const arcs = graph.adjacency.get(nb.walk[i]!)!;
        expect(arcs.some((a) => a.to === nb.walk[i + 1])).toBe(true);
      }
    }
  });
});

describe("computeRoundTrips (E2E, Overpass モック注入)", () => {
  it("目標距離に近い周回路を生成する", async () => {
    const ways = gridWays(41, 41, 50, ORIGIN); // 2km 四方
    const center = {
      lat: ORIGIN.lat + 20 * (50 / 111320),
      lng: ORIGIN.lng + 20 * (50 / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180))),
    };
    const computed = await computeRoundTrips(
      {
        lat: center.lat,
        lng: center.lng,
        targetMeters: 1200,
        profile: "walk",
        avoidSignals: false,
        avoidNarrowRoads: false,
      },
      {
        enableLocalSearch: true,
        fetchNetwork: async () => ({
          ways,
          fetchMs: 0,
          signalNodes: new Set<number>(),
        }),
      }
    );
    expect(computed.ok).toBe(true);
    if (!computed.ok) throw new Error(computed.error.message);
    const result = computed.value;
    expect(result.candidates.length).toBeGreaterThan(0);
    const best = result.candidates[0]!;
    // 最良候補は目標 1200m に近い（detour 補正で ±15% 以内）、重複は 45% 以下
    expect(best.lengthError / 1200).toBeLessThanOrEqual(0.15);
    expect(best.overlapPercent).toBeLessThanOrEqual(45);
    // 表示する全候補が目標±15%以内（別方向の overshoot を出さない）
    for (const c of result.candidates) {
      expect(c.lengthError / 1200).toBeLessThanOrEqual(0.15);
    }
    // 閉路（始点に戻る）
    expect(best.path[0]).toEqual(result.start);
    expect(best.path[best.path.length - 1]).toEqual(result.start);
  });
});
