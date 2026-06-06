import { z } from "zod";

/** Garmin/Strava CSV から取り込む 1 アクティビティ。 */
export interface Activity {
  /** ISO 日時（CSV の「日付」）。 */
  date: string;
  /** アクティビティタイプ（"ラン" など）。 */
  type: string;
  title: string;
  distanceKm: number;
  durationSec: number;
  /** 平均ペース（秒/km）。不明なら null。 */
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  ascentM: number | null;
}

/** 目標レース。距離は任意に設定可能。 */
export const raceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** YYYY-MM-DD。 */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  distanceKm: z.number().positive().max(300),
  /** 目標タイム（秒）。任意。設定すると VDOT からペース設計する。 */
  goalTimeSec: z.number().positive().max(24 * 3600).optional(),
});
export type Race = z.infer<typeof raceSchema>;

/** 曜日(0=日..6=土)ごとの練習可否と確保できる時間。 */
export const dayAvailabilitySchema = z.object({
  isPracticeDay: z.boolean(),
  maxMinutes: z.number().min(0).max(600),
});
export type DayAvailability = z.infer<typeof dayAvailabilitySchema>;

/** 長さ 7（index=曜日）。 */
export type WeeklyAvailability = DayAvailability[];

export type WorkoutType =
  | "rest"
  | "easy"
  | "long"
  | "tempo"
  | "interval"
  | "race";

export type TrainingPhase = "base" | "build" | "peak" | "taper" | "race";

export interface PlannedWorkout {
  /** YYYY-MM-DD。 */
  date: string;
  /** 0 始まりの週番号。 */
  weekIndex: number;
  phase: TrainingPhase;
  type: WorkoutType;
  /** 距離(km)。rest は 0。確保時間の上限で短縮される場合がある。 */
  distanceKm: number;
  /** 推定所要時間(分)。指定ペースから算出。 */
  estMinutes: number;
  /** 指定ペース（秒/km）。rest は省略。 */
  paceSecPerKm?: number;
  /** 推奨心拍ゾーン（1..5）。最大心拍が分かる場合のみ。 */
  hrZone?: number;
  /** 推奨心拍ゾーンの bpm 範囲（例 "132–145"）。 */
  hrBpmRange?: string;
  title: string;
  note?: string;
  /** 確保時間の上限により距離を短縮したか。 */
  cappedByTime?: boolean;
  /** その週の「ポイント練習」（週1つ）。 */
  isKey?: boolean;
}

/** 直近のアクティビティから推定した走力。 */
export interface Fitness {
  /** 直近の週間走行距離(km)の目安。 */
  weeklyKm: number;
  /** 直近の最長単走(km)。 */
  longestKm: number;
  /** イージーペースの目安(秒/km)。 */
  easyPaceSecPerKm: number;
  /** 現在の推定 VDOT（直近ベスト走から）。不明なら null。 */
  currentVdot: number | null;
  /** 観測上の最大心拍。不明なら null。 */
  maxHrObserved: number | null;
}

export interface PlanInput {
  /** 計画開始日 YYYY-MM-DD（通常は今日）。 */
  startDate: string;
  race: Race;
  fitness: Fitness;
  availability: WeeklyAvailability;
  /**
   * 週あたりに走る回数。可能日の中からこの回数だけを実際の練習日に選ぶ。
   * 未指定なら可能日すべてを使う。可能日数を超える場合は可能日数にクランプ。
   */
  runsPerWeek?: number;
  /** rest 扱いにする日（スキップ済み）。 */
  skippedDates?: string[];
}

/** 既定の週間設定: 火・木・土を練習日、各 60 分、土は 120 分。 */
export const defaultAvailability = (): WeeklyAvailability =>
  [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const isPracticeDay = wd === 2 || wd === 4 || wd === 6;
    const maxMinutes = wd === 6 ? 120 : isPracticeDay ? 60 : 0;
    return { isPracticeDay, maxMinutes };
  });
