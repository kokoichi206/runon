import { neighbors, type NodeId, type StreetGraph } from "@/server/lib/routing/graph";
import {
  dominates,
  evaluateWalk,
  removeOutAndBack,
  type WalkMetrics,
} from "@/server/lib/routing/walk";

export interface Solution {
  walk: NodeId[];
  metrics: WalkMetrics;
}

/**
 * ダミー頂点 u'i の識別子（OSM ノード ID は正なので負値で衝突しない）。
 */
const DUMMY: NodeId = -1;

const directedKey = (from: NodeId, to: NodeId): string => `${from}->${to}`;

/**
 * 歩行 S の有向弧集合（残余グラフで除去する弧）。
 */
const arcsOf = (walk: NodeId[]): Set<string> => {
  const s = new Set<string>();
  for (let i = 0; i + 1 < walk.length; i++) {
    s.add(directedKey(walk[i]!, walk[i + 1]!));
  }
  return s;
};

/**
 * 論文 Algorithm 4 の近傍木。
 * ui を根に、S の弧を除いた残余グラフ上で BFS。ui へ戻る入弧はダミー DUMMY に張り替える。
 * 返す parent から、ui→(任意ノード) および ui→DUMMY の最少弧経路を復元できる。
 */
const bfsResidualTree = (
  graph: StreetGraph,
  ui: NodeId,
  removedArcs: Set<string>,
  maxVisits: number
): Map<NodeId, NodeId> => {
  const parent = new Map<NodeId, NodeId>();
  const visited = new Set<NodeId>([ui]);
  const queue: NodeId[] = [ui];
  let head = 0;
  while (head < queue.length) {
    // 巨大グラフでの全探索を防ぐ訪問上限。近傍の再接続は局所で十分。
    if (visited.size >= maxVisits) break;
    const u = queue[head++]!;
    if (u === DUMMY) continue; // シンク
    for (const arc of neighbors(graph, u)) {
      if (removedArcs.has(directedKey(u, arc.to))) continue;
      const to = arc.to === ui ? DUMMY : arc.to;
      if (visited.has(to)) continue;
      visited.add(to);
      parent.set(to, u);
      queue.push(to);
    }
  }
  return parent;
};

const pathTo = (parent: Map<NodeId, NodeId>, ui: NodeId, target: NodeId): NodeId[] | null => {
  if (target === ui) return [ui];
  const path: NodeId[] = [target];
  let cur = target;
  const guard = new Set<NodeId>();
  while (cur !== ui) {
    if (guard.has(cur)) return null;
    guard.add(cur);
    const p = parent.get(cur);
    if (p === undefined) return null;
    path.push(p);
    cur = p;
  }
  path.reverse();
  return path;
};

export interface NeighborOptions {
  /**
   * 1 解あたりに走査するカット頂点 ui の最大数（等間隔サンプル）。
   */
  maxCutVertices?: number;
  /**
   * カット頂点ごとに採用する区間終点 uj の最大数。
   */
  maxSegmentTargets?: number;
  /**
   * bfsResidualTree が訪問するノード上限（巨大グラフでの暴走防止）。
   */
  maxVisits?: number;
  /**
   * 絶対時刻(ms)。これを過ぎたら近傍生成を打ち切る（1反復の長すぎ防止）。
   */
  deadline?: number;
}

/**
 * 論文 Algorithm 4 による近傍生成。
 * 各カット頂点 ui について 1 回の BFS 木から、
 *  (a) 区間置換: S[i..j] を新経路 ui..uj で置換、
 *  (b) サブサイクル付加: ui..u'i の閉路を ui に挿入、
 * を生成する。
 */
export const generateNeighbors = (
  graph: StreetGraph,
  walk: NodeId[],
  startNode: NodeId,
  targetMeters: number,
  opts: NeighborOptions = {}
): Solution[] => {
  const maxCuts = opts.maxCutVertices ?? 24;
  const maxTargets = opts.maxSegmentTargets ?? 6;
  const maxVisits = opts.maxVisits ?? Number.POSITIVE_INFINITY;
  const deadline = opts.deadline;
  const removedArcs = arcsOf(walk);
  const len = walk.length;
  const out: Solution[] = [];

  // カット頂点 i を等間隔にサンプル（i は 0..len-2）。
  const cutCount = Math.min(maxCuts, Math.max(1, len - 1));
  const cutStride = Math.max(1, Math.floor((len - 1) / cutCount));

  for (let i = 0; i < len - 1; i += cutStride) {
    if (deadline !== undefined && Date.now() > deadline) break;
    const ui = walk[i]!;
    const parent = bfsResidualTree(graph, ui, removedArcs, maxVisits);

    // (a) 区間置換: j を i+1..len-1 から等間隔に最大 maxTargets 個。
    const jCandidates: number[] = [];
    const remaining = len - 1 - (i + 1);
    const jStride = Math.max(1, Math.floor(remaining / maxTargets));
    for (let j = i + 2; j <= len - 1; j += jStride) jCandidates.push(j);
    if (!jCandidates.includes(len - 1)) jCandidates.push(len - 1);

    for (const j of jCandidates) {
      const uj = walk[j]!;
      if (uj === DUMMY) continue;
      const seg = pathTo(parent, ui, uj);
      if (!seg || seg.length < 2) continue;
      const newWalk = [...walk.slice(0, i), ...seg, ...walk.slice(j + 1)];
      const sol = finalize(graph, newWalk, startNode, targetMeters);
      if (sol) out.push(sol);
    }

    // (b) サブサイクル付加: ui -> u'i の閉路を挿入。
    const cyc = pathTo(parent, ui, DUMMY);
    if (cyc && cyc.length >= 3) {
      // cyc = [ui, ..., v, DUMMY] -> 末尾 DUMMY を ui に戻して閉路化。
      const cycle = [...cyc.slice(0, -1), ui];
      const newWalk = [...walk.slice(0, i), ...cycle, ...walk.slice(i + 1)];
      const sol = finalize(graph, newWalk, startNode, targetMeters);
      if (sol) out.push(sol);
    }
  }

  return out;
};

const finalize = (
  graph: StreetGraph,
  walk: NodeId[],
  startNode: NodeId,
  targetMeters: number
): Solution | null => {
  if (walk.length < 3) return null;
  if (walk[0] !== startNode || walk[walk.length - 1] !== startNode) return null;
  const trimmed = removeOutAndBack(walk, startNode);
  if (trimmed.length < 3) return null;
  const metrics = evaluateWalk(graph, trimmed, targetMeters);
  if (metrics.lengthMeters < targetMeters * 0.3 || metrics.lengthMeters > targetMeters * 3) {
    return null;
  }
  return {
    walk: trimmed,
    metrics,
  };
};

const signatureOf = (m: WalkMetrics): string =>
  `${Math.round(m.lengthMeters)}:${Math.round(m.overlapPercent * 10)}`;

/**
 * 解 cand をアーカイブに挿入（パレート支配を維持）。挿入したら true。
 */
const tryInsert = (archive: Solution[], cand: Solution): boolean => {
  for (const a of archive) {
    if (dominates(a.metrics, cand.metrics)) return false;
    if (
      a.metrics.lengthError === cand.metrics.lengthError &&
      a.metrics.overlapPercent === cand.metrics.overlapPercent
    ) {
      return false; // 同等解は重複追加しない
    }
  }
  // cand に支配される既存解を除去。
  for (let i = archive.length - 1; i >= 0; i--) {
    if (dominates(cand.metrics, archive[i]!.metrics)) archive.splice(i, 1);
  }
  archive.push(cand);
  return true;
};

export interface ParetoLocalSearchOptions extends NeighborOptions {
  maxIterations?: number;
  maxArchive?: number;
  timeBudgetMs?: number;
}

/**
 * 論文 Algorithm 3: 多目的パレート局所探索。
 * 初期解集合から近傍を生成し、非支配解のアーカイブを反復的に拡張・改善する。
 */
export const paretoLocalSearch = (
  graph: StreetGraph,
  startNode: NodeId,
  targetMeters: number,
  initial: Solution[],
  opts: ParetoLocalSearchOptions = {}
): Solution[] => {
  const maxIterations = opts.maxIterations ?? 300;
  const maxArchive = opts.maxArchive ?? 40;
  const timeBudgetMs = opts.timeBudgetMs ?? 4000;
  const startedAt = Date.now();
  // 反復間だけでなく近傍生成の内側でも見る締切。巨大グラフで1反復が予算を大きく超えるのを防ぐ。
  const deadline = startedAt + timeBudgetMs;

  const archive: Solution[] = [];
  const unvisited: Solution[] = [];
  const visited = new Set<string>();

  for (const sol of initial) {
    if (tryInsert(archive, sol)) unvisited.push(sol);
  }

  let iterations = 0;
  while (unvisited.length > 0 && iterations < maxIterations) {
    if (Date.now() > deadline) break;
    iterations++;
    const current = unvisited.shift()!;
    const sig = signatureOf(current.metrics);
    if (visited.has(sig)) continue;
    visited.add(sig);

    const neighborsList = generateNeighbors(graph, current.walk, startNode, targetMeters, {
      ...opts,
      deadline,
    });
    for (const nb of neighborsList) {
      if (visited.has(signatureOf(nb.metrics))) continue;
      if (tryInsert(archive, nb)) {
        unvisited.push(nb);
        if (archive.length > maxArchive) {
          // アーカイブ過多時は overlap 最大の非フロント寄り解を 1 つ間引く。
          let worst = 0;
          for (let i = 1; i < archive.length; i++) {
            if (archive[i]!.metrics.overlapPercent > archive[worst]!.metrics.overlapPercent) {
              worst = i;
            }
          }
          archive.splice(worst, 1);
        }
      }
    }
  }

  return archive;
};
