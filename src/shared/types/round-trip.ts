import { z } from "zod";

/**
 * 移動プロファイル。論文の有向グラフ構築に対応する。
 * - walk: すべての道を双方向として扱う（歩行者は一方通行を無視できる）
 * - bike: 一方通行 (oneway) を尊重する
 */
export const profileSchema = z.enum(["walk", "bike"]);
export type Profile = z.infer<typeof profileSchema>;

/**
 * ラウンドトリップ計算リクエスト。
 * targetMeters = 論文の k（目標とする周回距離）。
 */
export const roundTripRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // 200m 未満は道路網として意味が薄く、上限はフルマラソン(42.195km)。
  // 取得半径は 15km にキャップ済みなので Overpass 負荷は 25km 時と同じ、計算は全体締切で打ち切る。
  targetMeters: z.number().min(200).max(42_195),
  profile: profileSchema.default("walk"),
  // true のとき、信号（traffic_signals）を避ける経路を生成し、信号・曲がりの少なさで並べ替える。
  avoidSignals: z.boolean().default(false),
  // true のとき、細い道（路地・遊歩道など highway 種別ベース）を避ける経路を生成し、細道の少なさで並べ替える。
  avoidNarrowRoads: z.boolean().default(false),
});
export type RoundTripRequest = z.infer<typeof roundTripRequestSchema>;

/**
 * GeoJSON 順序 [lng, lat] の座標。
 */
export type LngLat = [number, number];

/**
 * Overpass `way ... out geom;` の要素。
 * 外部 API の形だが repository（取得）と lib/osm（グラフ構築）の両方が参照するため shared に置く。
 */
export interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export interface RoundTripCandidate {
  id: string;
  /**
   * 周回経路の全ポリライン（始点 = 終点）。GeoJSON 順 [lng, lat]。
   */
  path: LngLat[];
  /**
   * 多角形ウェイポイント（始点を含む）。可視化・デバッグ用。
   */
  waypoints: LngLat[];
  /**
   * 実距離 L(S)（メートル）。
   */
  lengthMeters: number;
  /**
   * f1 = |k - L(S)|（メートル）。小さいほど目標距離に近い。
   */
  lengthError: number;
  /**
   * f2 = 既踏破区間の再通過割合（%）。小さいほど往復が少ない。
   */
  overlapPercent: number;
  /**
   * パレートフロント上の解か。
   */
  onParetoFront: boolean;
  /**
   * 経路中の曲がり（一定角度以上の方位変化）の回数。少ないほど走りやすい。
   */
  turnCount: number;
  /**
   * 経路が通る信号（traffic_signals）の数。信号データを取得しなかった場合は null。
   */
  signalCount: number | null;
  /**
   * 経路が通る「細い道」区間の本数。細道回避を有効にしなかった場合は null。
   */
  narrowCount: number | null;
  /**
   * この候補を生み出した手法。
   */
  source: "isochrone-polygon" | "pareto-local-search";
}

export interface RoundTripResult {
  /**
   * start に最も近い道路ノードへスナップした実際の始点。
   */
  start: LngLat;
  /**
   * 推奨候補の id（パレートフロントから重み付けで選択）。
   */
  recommendedId: string;
  /**
   * 全候補（パレートフロント + 参考解）。lengthError 昇順。
   */
  candidates: RoundTripCandidate[];
  stats: {
    graphNodes: number;
    graphEdges: number;
    reachableNodes: number;
    computeMs: number;
    overpassMs: number;
  };
  attribution: string;
}
