import { z } from "zod";

/** その走の中で Strava が算出したベストエフォート（最速 1k/5k/10k など）。 */
export interface BestEffort {
  /** Strava の区間名（"5k" "10k" "1 mile" など）。 */
  name: string;
  distanceM: number;
  timeSec: number;
}

/** Strava の workout_type をラン向けに分類したもの。 */
export type WorkoutKind = "race" | "long" | "workout" | "default";

/**
 * Garmin/Strava CSV から取り込む 1 アクティビティ。
 * date 以降の基本5項目は両ソース共通。以降の optional 群は Strava のみが供給し得る
 * 拡張データ（CSV では未設定。心拍計・サブスク有無で欠ける場合もある）。
 */
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
  /** 経過時間（秒。停止含む）。Strava の elapsed_time。 */
  elapsedSec?: number;
  /** 平均ケイデンス（歩/分）。Strava は片脚 rpm を返すため取り込み時に 2 倍する。 */
  avgCadenceSpm?: number;
  /** 最高速ペース（秒/km）。Strava の max_speed から換算。 */
  maxSpeedSecPerKm?: number;
  /** 心拍が記録されていたか。 */
  hasHeartrate?: boolean;
  /** ワークアウト種別（Strava workout_type 由来）。 */
  workoutKind?: WorkoutKind;
  /** Relative Effort（Strava suffer_score。心拍ベースの実測トレーニング負荷）。 */
  relativeEffort?: number;
  /** その走のベストエフォート群（詳細取得した活動のみ）。 */
  bestEfforts?: BestEffort[];
}

/** Strava のアスリート情報・長期集計（活動単位でないので Activity と別系統）。 */
export interface AthleteRunTotals {
  distanceKm: number;
  durationSec: number;
  count: number;
}

export interface AthleteProfile {
  weightKg?: number;
  sex?: "M" | "F";
  /** 直近4週相当のラン集計（Strava stats）。 */
  recentRunTotals?: AthleteRunTotals;
  /** 全期間のラン集計（Strava stats）。 */
  allRunTotals?: AthleteRunTotals;
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
  /**
   * 実測トレーニング負荷サマリ（ACWR）。relativeEffort が十分な活動にのみ算出。
   * データ不足（CSV のみ・非サブスク等）では null。
   */
  recentLoad?: RecentLoad | null;
}

/** 急性(7日)/慢性(7日換算の28日平均)負荷とその比。 */
export interface RecentLoad {
  /** 直近7日の負荷合計。 */
  acute: number;
  /** 直近28日の負荷合計を7日スケールに換算した値。 */
  chronic: number;
  /** acute / chronic。1.5 超で急増（故障リスク帯）。 */
  ratio: number;
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
