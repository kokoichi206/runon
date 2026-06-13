import { z } from "zod";

/**
 * その走の中で Strava が算出したベストエフォート（最速 1k/5k/10k など）。
 */
export interface BestEffort {
  /**
   * Strava の区間名（"5k" "10k" "1 mile" など）。
   */
  name: string;
  distanceM: number;
  timeSec: number;
}

/**
 * Strava の workout_type をラン向けに分類したもの。
 */
export type WorkoutKind = "race" | "long" | "workout" | "default";

/**
 * Garmin/Strava CSV から取り込む 1 アクティビティ。
 * date 以降の基本5項目は両ソース共通。以降の optional 群は Strava のみが供給し得る
 * 拡張データ（CSV では未設定。心拍計・サブスク有無で欠ける場合もある）。
 */
export interface Activity {
  /**
   * ISO 日時（CSV の「日付」）。
   */
  date: string;
  /**
   * アクティビティタイプ（"ラン" など）。
   */
  type: string;
  title: string;
  distanceKm: number;
  durationSec: number;
  /**
   * 平均ペース（秒/km）。不明なら null。
   */
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  ascentM: number | null;
  /**
   * 経過時間（秒。停止含む）。Strava の elapsed_time。
   */
  elapsedSec?: number;
  /**
   * 平均ケイデンス（歩/分）。Strava は片脚 rpm を返すため取り込み時に 2 倍する。
   */
  avgCadenceSpm?: number;
  /**
   * 最高速ペース（秒/km）。Strava の max_speed から換算。
   */
  maxSpeedSecPerKm?: number;
  /**
   * 心拍が記録されていたか。
   */
  hasHeartrate?: boolean;
  /**
   * ワークアウト種別（Strava workout_type 由来）。
   */
  workoutKind?: WorkoutKind;
  /**
   * Relative Effort（Strava suffer_score。心拍ベースの実測トレーニング負荷）。
   */
  relativeEffort?: number;
  /**
   * その走のベストエフォート群（詳細取得した活動のみ）。
   */
  bestEfforts?: BestEffort[];
}

/**
 * Strava のアスリート情報・長期集計（活動単位でないので Activity と別系統）。
 */
export interface AthleteRunTotals {
  distanceKm: number;
  durationSec: number;
  count: number;
}

export interface AthleteProfile {
  weightKg?: number;
  sex?: "M" | "F";
  /**
   * 直近4週相当のラン集計（Strava stats）。
   */
  recentRunTotals?: AthleteRunTotals;
  /**
   * 全期間のラン集計（Strava stats）。
   */
  allRunTotals?: AthleteRunTotals;
}

/**
 * 目標レース。距離は任意に設定可能。
 */
export const raceSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /**
   * YYYY-MM-DD。
   */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  distanceKm: z.number().positive().max(300),
  /**
   * 目標タイム（秒）。任意。設定すると VDOT からペース設計する。
   */
  goalTimeSec: z
    .number()
    .positive()
    .max(24 * 3600)
    .optional(),
});
export type Race = z.infer<typeof raceSchema>;

/**
 * 曜日(0=日..6=土)ごとの練習可否と確保できる時間。
 */
export const dayAvailabilitySchema = z.object({
  isPracticeDay: z.boolean(),
  maxMinutes: z.number().min(0).max(600),
});
export type DayAvailability = z.infer<typeof dayAvailabilitySchema>;

/**
 * 長さ 7（index=曜日）。
 */
export type WeeklyAvailability = DayAvailability[];

export type WorkoutType =
  | "rest"
  | "easy"
  | "long"
  | "tempo"
  | "interval"
  | "repetition"
  | "timeTrial"
  | "race";

export type TrainingPhase = "base" | "build" | "peak" | "taper" | "race";

/**
 * 練習メニューを構成する区間。Daniels 式セッション（反復・つなぎを含む）を
 * 文字列でなく構造化して持つ。表示側で人間可読な文言に変換する。
 */
export type WorkoutSegment =
  | {
    /**
       * 連続走（WU/CD・イージー・ロング・連続テンポ）。
       */
    kind: "run";
    role: "warmup" | "cooldown" | "steady" | "easy" | "long";
    distanceKm: number;
    paceSecPerKm: number;
  }
  | {
    /**
       * 反復（クルーズインターバル=T / インターバル=I / レペティション=R）。
       */
    kind: "reps";
    role: "threshold" | "interval" | "repetition";
    reps: number;
    /**
       * 1 本の距離(m)。
       */
    repMeters: number;
    paceSecPerKm: number;
    /**
       * 1 本ごとのつなぎ（リカバリー）距離(m)。
       */
    recoverMeters: number;
    recoverKind: "jog" | "walk";
  };

export interface PlannedWorkout {
  /**
   * YYYY-MM-DD。
   */
  date: string;
  /**
   * 0 始まりの週番号。
   */
  weekIndex: number;
  phase: TrainingPhase;
  type: WorkoutType;
  /**
   * 距離(km)。rest は 0。確保時間の上限で短縮される場合がある。
   */
  distanceKm: number;
  /**
   * 推定所要時間(分)。指定ペースから算出。
   */
  estMinutes: number;
  /**
   * 指定ペース（秒/km）。rest は省略。
   */
  paceSecPerKm?: number;
  /**
   * 推奨心拍ゾーン（1..5）。最大心拍が分かる場合のみ。
   */
  hrZone?: number;
  /**
   * 推奨心拍ゾーンの bpm 範囲（例 "132–145"）。
   */
  hrBpmRange?: string;
  title: string;
  note?: string;
  /**
   * 確保時間の上限により距離を短縮したか。
   */
  cappedByTime?: boolean;
  /**
   * その週の「ポイント練習」（週1つ）。
   */
  isKey?: boolean;
  /**
   * メニュー構成（Daniels 式の反復・つなぎを含む）。質練習のみ設定し、
   * 連続走（easy/long）や rest では省略。distanceKm/estMinutes はこの合計。
   */
  segments?: WorkoutSegment[];
}

/**
 * 直近のアクティビティから推定した走力。
 */
export interface Fitness {
  /**
   * 直近の週間走行距離(km)の目安。
   */
  weeklyKm: number;
  /**
   * 直近の最長単走(km)。
   */
  longestKm: number;
  /**
   * イージーペースの目安(秒/km)。
   */
  easyPaceSecPerKm: number;
  /**
   * 現在の推定 VDOT（直近ベスト走から）。不明なら null。
   */
  currentVdot: number | null;
  /**
   * 観測上の最大心拍。不明なら null。
   */
  maxHrObserved: number | null;
  /**
   * 実測トレーニング負荷サマリ（ACWR）。relativeEffort が十分な活動にのみ算出。
   * データ不足（CSV のみ・非サブスク等）では null。
   */
  recentLoad?: RecentLoad | null;
}

/**
 * 急性(7日)/慢性(7日換算の28日平均)負荷とその比。
 */
export interface RecentLoad {
  /**
   * 直近7日の負荷合計。
   */
  acute: number;
  /**
   * 直近28日の負荷合計を7日スケールに換算した値。
   */
  chronic: number;
  /**
   * acute / chronic。1.5 超で急増（故障リスク帯）。
   */
  ratio: number;
}

export interface PlanInput {
  /**
   * 計画開始日 YYYY-MM-DD（通常は今日）。
   */
  startDate: string;
  race: Race;
  fitness: Fitness;
  availability: WeeklyAvailability;
  /**
   * 週あたりに走る回数。可能日の中からこの回数だけを実際の練習日に選ぶ。
   * 未指定なら可能日すべてを使う。可能日数を超える場合は可能日数にクランプ。
   */
  runsPerWeek?: number;
  /**
   * rest 扱いにする日（スキップ済み）。
   */
  skippedDates?: string[];
}

/**
 * 目標レースを設定しない「5km 強化ブロック」の入力。
 * 終端をレース日でなく週数で決め、4 週サイクル（T→I→R→3000m TT）を繰り返す。
 */
export interface BlockPlanInput {
  /**
   * 計画開始日 YYYY-MM-DD（通常は今日）。
   */
  startDate: string;
  /**
   * 計画の週数（ユーザー指定）。
   */
  weeks: number;
  /**
   * 主眼となるレース距離(km)。当面は 5km。ロング走の目安に使う。
   */
  targetDistanceKm: number;
  fitness: Fitness;
  availability: WeeklyAvailability;
  runsPerWeek?: number;
  skippedDates?: string[];
}

/**
 * 既定の週間設定: 日・火・木・土を練習日、火・木は各 60 分、日・土は 120 分。
 */
export const defaultAvailability = (): WeeklyAvailability =>
  [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const isPracticeDay = wd === 0 || wd === 2 || wd === 4 || wd === 6;
    const maxMinutes = wd === 0 || wd === 6 ? 120 : isPracticeDay ? 60 : 0;
    return {
      isPracticeDay,
      maxMinutes,
    };
  });

/**
 * 実測負荷（ACWR）の検証スキーマ。
 */
export const recentLoadSchema = z.object({
  acute: z.number(),
  chronic: z.number(),
  ratio: z.number(),
}) satisfies z.ZodType<RecentLoad>;

/**
 * 推定走力（Fitness）の検証スキーマ。サーバー境界（Server Action）で入力を検証する。
 *
 * recentLoad は client が算出した ACWR。これを通さないと zod のストリップで欠落し、
 * サーバー経路で序盤の負荷調整（startVolumeFactor）が効かなくなる（UI 表示と不一致になる）。
 */
export const fitnessSchema = z.object({
  weeklyKm: z.number(),
  longestKm: z.number(),
  easyPaceSecPerKm: z.number(),
  currentVdot: z.number().nullable(),
  maxHrObserved: z.number().nullable(),
  recentLoad: recentLoadSchema.nullable().optional(),
}) satisfies z.ZodType<Fitness>;

/**
 * 計画リクエストの共通部分（モードに依らず必要なもの）。
 * fitness は client 側で算出済みのものを渡す（走力表示と同じ値を使う）。
 */
const planRequestBase = {
  /**
   * 計画開始日 YYYY-MM-DD（通常は今日）。
   */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fitness: fitnessSchema,
  availability: z.array(dayAvailabilitySchema).length(7),
  runsPerWeek: z.number().int().min(1).max(7).optional(),
  skippedDates: z.array(z.string()).optional(),
};

/**
 * トレーニング計画生成リクエスト。Server Action / handler の入口で検証する。
 * mode で「目標レースから(race)」と「5km 強化ブロック(block)」を判別し、
 * 各モードで必要なフィールドを型・検証で固定する（任意 race のフォールバックを書かない）。
 */
export const trainingPlanRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("race"),
    ...planRequestBase,
    race: raceSchema,
  }),
  z.object({
    mode: z.literal("block"),
    ...planRequestBase,
    /**
     * 計画の週数（ユーザー指定）。
     */
    weeks: z.number().int().min(1).max(52),
    /**
     * 主眼レース距離(km)。既定 5km。
     */
    targetDistanceKm: z.number().positive().max(100).default(5),
  }),
]);
export type TrainingPlanRequest = z.infer<typeof trainingPlanRequestSchema>;
