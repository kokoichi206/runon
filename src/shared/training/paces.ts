import { isoToYmdLocal, parseYmd } from "@/shared/training/date";
import type { Activity } from "@/shared/types/training";

/**
 * Jack Daniels の VDOT モデルに基づくペース計算。
 * - VO2(速度) と %VO2max(時間) の経験式から VDOT（有効 VO2max）を求める。
 * - 各トレーニングゾーンは %VO2max の代表値から速度を逆算する（近似）。
 * 係数は Daniels' Running Formula の公表式。ゾーンの % は実用的な近似値。
 */

// vo2 = -4.60 + 0.182258 v + 0.000104 v^2   (v: m/min)
const vo2FromVelocity = (v: number): number => -4.6 + 0.182258 * v + 0.000104 * v * v;

// 上式を v について解く（正の根）。
const velocityFromVo2 = (vo2: number): number => {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + vo2);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
};

// レース時間 t(分) における %VO2max（持続率）。
const pctMaxForMinutes = (tMin: number): number =>
  0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);

/** 実績(距離km, 時間sec)から VDOT を推定。 */
export function vdotFromPerformance(distanceKm: number, timeSec: number): number {
  const tMin = timeSec / 60;
  const v = (distanceKm * 1000) / tMin; // m/min
  const vo2 = vo2FromVelocity(v);
  const pct = pctMaxForMinutes(tMin);
  return vo2 / pct;
}

/** VDOT と距離から到達見込みタイム(sec)を二分探索で求める（vdotFromPerformance の逆）。 */
export function predictTimeSec(vdot: number, distanceKm: number): number {
  let lo = 60; // 1 分
  let hi = 8 * 3600; // 8 時間
  // f(sec)=vdotFromPerformance は sec について単調減少。
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const v = vdotFromPerformance(distanceKm, mid);
    if (v > vdot) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export interface TrainingPaces {
  /** 秒/km */
  easy: number;
  marathon: number;
  threshold: number;
  interval: number;
}

// ゾーンごとの %VO2max（VDOT に対する割合）。I は vVDOT(=100%)。
const ZONE_PCT = { easy: 0.7, marathon: 0.84, threshold: 0.88, interval: 1.0 };

const paceFromVo2 = (vo2: number): number => 60000 / velocityFromVo2(vo2);

/** VDOT から各ゾーンのペース(秒/km)を導く。 */
export function trainingPaces(vdot: number): TrainingPaces {
  return {
    easy: Math.round(paceFromVo2(ZONE_PCT.easy * vdot)),
    marathon: Math.round(paceFromVo2(ZONE_PCT.marathon * vdot)),
    threshold: Math.round(paceFromVo2(ZONE_PCT.threshold * vdot)),
    interval: Math.round(paceFromVo2(ZONE_PCT.interval * vdot)),
  };
}

/** VDOT 入力に採るベストエフォートの最短距離。短距離全力は過大評価になるため除外。 */
const MIN_EFFORT_M = 3000;

interface Performance {
  distanceKm: number;
  timeSec: number;
}

/**
 * 最大心拍が分かるなら、本当に追い込んだ走(avgHr ≥ 80%HRmax)に絞る。
 * 該当が無ければ全体を返す（過小/過大評価を減らすための従来ヒューリスティック）。
 */
function hrFilteredPerformances(pool: Activity[], maxHr: number | null): Performance[] {
  let p = pool;
  if (maxHr) {
    const hard = pool.filter((a) => a.avgHr !== null && a.avgHr >= 0.8 * maxHr);
    if (hard.length > 0) p = hard;
  }
  return p.map((a) => ({ distanceKm: a.distanceKm, timeSec: a.durationSec }));
}

/**
 * 直近のラン履歴から現在の推定 VDOT を求める。
 * 優先度: best_efforts(3km 以上) / レース走の実測 > 心拍で絞った練習走。
 * Strava の best_efforts・workout_type が無い履歴（CSV 等）では従来の心拍フィルタ経路に一致。
 * 該当走が無ければ null。
 */
export function estimateCurrentVdot(
  activities: Activity[],
  nowMs: number,
  maxHr: number | null = null
): number | null {
  const base = activities.filter((a) => a.distanceKm >= 2 && a.durationSec > 0);
  const recent = base.filter((a) => nowMs - parseYmd(isoToYmdLocal(a.date)) <= 56 * 86_400_000);
  const pool = recent.length > 0 ? recent : base;
  if (pool.length === 0) return null;

  // best_efforts と レース走は「追い込んだ既知距離の実測」なので最優先で採用する。
  const measured: Performance[] = [];
  for (const a of pool) {
    for (const b of a.bestEfforts ?? []) {
      if (b.distanceM >= MIN_EFFORT_M && b.timeSec > 0) {
        measured.push({ distanceKm: b.distanceM / 1000, timeSec: b.timeSec });
      }
    }
    if (a.workoutKind === "race") {
      measured.push({ distanceKm: a.distanceKm, timeSec: a.durationSec });
    }
  }

  const source = measured.length > 0 ? measured : hrFilteredPerformances(pool, maxHr);
  if (source.length === 0) return null;
  let best = 0;
  for (const p of source) {
    const v = vdotFromPerformance(p.distanceKm, p.timeSec);
    if (v > best) best = v;
  }
  return Math.round(best * 10) / 10;
}

export type Feasibility = "現実的" | "挑戦的" | "厳しい" | "不明";

export interface ProgressionSummary {
  currentVdot: number | null;
  goalVdot: number;
  goalTimeSec: number;
  /** 現走力での到達見込みタイム(sec)。currentVdot 不明なら null。 */
  predictedCurrentTimeSec: number | null;
  /** 目標までに必要なタイム短縮率(%)。 */
  requiredImprovementPct: number | null;
  feasibility: Feasibility;
  weeks: number;
  currentPaces: TrainingPaces | null;
  goalPaces: TrainingPaces;
}

/**
 * 現状から目標への「伸ばし方」サマリを作る。
 * 残り週数での妥当な VDOT 改善（控えめに ~0.35pt/週、上限 現VDOTの12%）と比較し
 * 実現可能性を正直に分類する。
 */
export function buildProgression(
  currentVdot: number | null,
  goalTimeSec: number,
  raceKm: number,
  weeks: number
): ProgressionSummary {
  const goalVdot = vdotFromPerformance(raceKm, goalTimeSec);
  const goalPaces = trainingPaces(goalVdot);

  if (currentVdot === null) {
    return {
      currentVdot: null,
      goalVdot: Math.round(goalVdot * 10) / 10,
      goalTimeSec,
      predictedCurrentTimeSec: null,
      requiredImprovementPct: null,
      feasibility: "不明",
      weeks,
      currentPaces: null,
      goalPaces,
    };
  }

  const predictedCurrentTimeSec = predictTimeSec(currentVdot, raceKm);
  const requiredImprovementPct =
    predictedCurrentTimeSec > goalTimeSec
      ? Math.round(((predictedCurrentTimeSec - goalTimeSec) / predictedCurrentTimeSec) * 1000) / 10
      : 0;

  const vdotGain = goalVdot - currentVdot;
  const plausibleGain = Math.min(0.35 * weeks, currentVdot * 0.12);
  let feasibility: Feasibility;
  if (vdotGain <= 0) feasibility = "現実的";
  else if (vdotGain <= plausibleGain) feasibility = "現実的";
  else if (vdotGain <= plausibleGain * 1.5) feasibility = "挑戦的";
  else feasibility = "厳しい";

  return {
    currentVdot,
    goalVdot: Math.round(goalVdot * 10) / 10,
    goalTimeSec,
    predictedCurrentTimeSec,
    requiredImprovementPct,
    feasibility,
    weeks,
    currentPaces: trainingPaces(currentVdot),
    goalPaces,
  };
}
