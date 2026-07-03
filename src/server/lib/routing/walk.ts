import { bearingDeg } from "@/server/lib/routing/geo";
import {
  arcWeight,
  undirectedEdgeKey,
  walkLengthMeters,
  type NodeId,
  type StreetGraph,
} from "@/server/lib/routing/graph";

// これ以上の方位変化を「曲がり」として数える閾値（度）。
const TURN_THRESHOLD_DEG = 35;

/**
 * 経路中の曲がり回数。連続ノード間の方位変化が閾値以上の交点を数える。
 * ホットパス(評価)とは分離し、最終候補にのみ適用する想定。
 */
export const countTurns = (graph: StreetGraph, walk: NodeId[]): number => {
  let turns = 0;
  for (let i = 1; i + 1 < walk.length; i++) {
    const a = graph.nodes.get(walk[i - 1]!);
    const b = graph.nodes.get(walk[i]!);
    const c = graph.nodes.get(walk[i + 1]!);
    if (!a || !b || !c) continue;
    let diff = Math.abs(bearingDeg(b, c) - bearingDeg(a, b)) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff >= TURN_THRESHOLD_DEG) turns++;
  }
  return turns;
};

// 経路が通る信号（traffic_signals）の数（重複ノードは1回として数える）。
export const countSignals = (graph: StreetGraph, walk: NodeId[]): number => {
  const seen = new Set<NodeId>();
  for (const id of walk) {
    if (graph.signalNodes.has(id)) seen.add(id);
  }
  return seen.size;
};

// 経路が通る「細い道」区間の本数（重複する無向エッジは1本として数える）。
export const countNarrowSegments = (graph: StreetGraph, walk: NodeId[]): number => {
  const seen = new Set<string>();
  for (let i = 0; i + 1 < walk.length; i++) {
    const a = walk[i]!;
    const b = walk[i + 1]!;
    if (a === b) continue;
    const key = undirectedEdgeKey(a, b);
    if (graph.narrowEdges.has(key)) seen.add(key);
  }
  return seen.size;
};

/**
 * 閉じた歩行 S の評価値。論文 Definition 6 の 2 目的。
 * - lengthError  f1(S) = |k - L(S)|
 * - overlapPercent f2(S) = 100 * (Σ_{多重度 x の無向辺} (x-1)*w) / L(S)
 */
export interface WalkMetrics {
  lengthMeters: number;
  lengthError: number;
  overlapPercent: number;
}

export const evaluateWalk = (
  graph: StreetGraph,
  walk: NodeId[],
  targetMeters: number
): WalkMetrics => {
  const lengthMeters = walkLengthMeters(graph, walk);
  const lengthError = Math.abs(targetMeters - lengthMeters);

  // 無向辺ごとの通過回数と重みを集計。
  const count = new Map<string, number>();
  const weight = new Map<string, number>();
  for (let i = 0; i + 1 < walk.length; i++) {
    const a = walk[i]!;
    const b = walk[i + 1]!;
    if (a === b) continue;
    const key = undirectedEdgeKey(a, b);
    count.set(key, (count.get(key) ?? 0) + 1);
    if (!weight.has(key)) weight.set(key, arcWeight(graph, a, b));
  }

  let repeated = 0;
  for (const [key, x] of count) {
    if (x > 1) repeated += (x - 1) * (weight.get(key) ?? 0);
  }
  const overlapPercent = lengthMeters > 0 ? (100 * repeated) / lengthMeters : 0;

  return {
    lengthMeters,
    lengthError,
    overlapPercent,
  };
};

/**
 * out-and-back（U ターンの行き止まり）除去。
 * 論文の「無向単純グラフ上で次数 1 の頂点を s 以外反復削除」と等価な操作を、
 * 歩行列に対する「即時バックトラックの畳み込み」として実装する:
 *   [.., A, B, A, ..] で A==両隣 なら B への往復を取り除き [.., A, ..] にする。
 * ネストした行き止まり (A,B,C,B,A) も反復で除去できる。閉路性を保つ。
 */
export const removeOutAndBack = (walk: NodeId[], start: NodeId): NodeId[] => {
  const current = walk.slice();
  for (;;) {
    let removedAt = -1;
    for (let i = 1; i + 1 < current.length; i++) {
      const tip = current[i]!;
      // s を行き止まり頂点として消さない（周回の起点を保持）。
      if (tip === start) continue;
      if (current[i - 1] === current[i + 1]) {
        removedAt = i;
        break;
      }
    }
    if (removedAt === -1) break;
    // 位置 i (tip) と i+1 (戻りの頂点) を削除し [..,A,B,A,X,..] -> [..,A,X,..]
    current.splice(removedAt, 2);
  }
  return current;
};

/**
 * a が b をパレート支配するか（(f1,f2) で全て以下かつどこかで真に小さい）。
 */
export const dominates = (a: WalkMetrics, b: WalkMetrics): boolean => {
  const le = a.lengthError <= b.lengthError && a.overlapPercent <= b.overlapPercent;
  const strict = a.lengthError < b.lengthError || a.overlapPercent < b.overlapPercent;
  return le && strict;
};
