import type { Activity, WorkoutType } from "@/shared/types/training";

/**
 * 心拍ゾーン（%HRmax モデル）。
 * 確保時間でなく強度の指針として、各練習に推奨ゾーンを併記する。
 */

/**
 * 取り込んだ活動から観測上の最大心拍を推定（最大心拍の最大値）。無ければ null。
 */
export const observedMaxHr = (activities: Activity[]): number | null => {
  let m = 0;
  for (const a of activities) {
    if (a.maxHr && a.maxHr > m) m = a.maxHr;
  }
  return m > 0 ? m : null;
};

export interface HrZone {
  zone: number;
  label: string;
  minBpm: number;
  maxBpm: number;
}

// 一般的な %HRmax 5 ゾーン。
const ZONE_FRAC: [number, number][] = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
];

export const hrZones = (maxHr: number): HrZone[] => {
  return ZONE_FRAC.map(([lo, hi], i) => ({
    zone: i + 1,
    label: `Z${i + 1}`,
    minBpm: Math.round(lo * maxHr),
    maxBpm: Math.round(hi * maxHr),
  }));
};

// 練習種別 -> 推奨ゾーン。
const TYPE_ZONE: Record<WorkoutType, number | undefined> = {
  rest: undefined,
  easy: 2,
  long: 2,
  tempo: 4,
  interval: 5,
  race: 4,
};

export const zoneForWorkout = (type: WorkoutType): number | undefined => {
  return TYPE_ZONE[type];
};

/**
 * 指定ゾーンの bpm 範囲文字列（例 "132–145"）。
 */
export const bpmRange = (maxHr: number, zone: number): string => {
  const z = hrZones(maxHr)[zone - 1];
  return z ? `${z.minBpm}–${z.maxBpm}` : "";
};
