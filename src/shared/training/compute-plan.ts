import { buildProgression, type ProgressionSummary } from "@/shared/training/paces";
import {
  generateBlockPlan,
  generatePlan,
  summarizeByWeek,
  type WeekSummary,
} from "@/shared/training/plan";
import type { PlannedWorkout, TrainingPlanRequest } from "@/shared/types/training";

/**
 * トレーニング計画生成の出力。日毎メニュー / 週サマリ / 伸ばし方サマリをまとめる。
 */
export interface TrainingPlanResult {
  plan: PlannedWorkout[];
  weeks: WeekSummary[];
  /**
   * 目標タイムが設定されている場合のみ算出。
   */
  progression: ProgressionSummary | null;
}

/**
 * 計画生成の合成ロジック（純粋）。client（ローカル即時計算）と server（Server Action,
 * 将来 LLM 等を合成）の双方から再利用する単一エントリ。
 */
export const computeTrainingPlan = (req: TrainingPlanRequest): TrainingPlanResult => {
  // 5km 強化ブロック（目標レース無し）。progression は目標が無いので持たない。
  if (req.mode === "block") {
    const plan = generateBlockPlan({
      startDate: req.today,
      weeks: req.weeks,
      targetDistanceKm: req.targetDistanceKm,
      fitness: req.fitness,
      availability: req.availability,
      runsPerWeek: req.runsPerWeek,
      skippedDates: req.skippedDates,
    });
    return {
      plan,
      weeks: summarizeByWeek(plan),
      progression: null,
    };
  }

  const plan = generatePlan({
    startDate: req.today,
    race: req.race,
    fitness: req.fitness,
    availability: req.availability,
    runsPerWeek: req.runsPerWeek,
    skippedDates: req.skippedDates,
  });
  const weeks = summarizeByWeek(plan);
  const progression =
    req.race.goalTimeSec !== undefined && weeks.length > 0
      ? buildProgression(
          req.fitness.currentVdot,
          req.race.goalTimeSec,
          req.race.distanceKm,
          weeks.length
        )
      : null;
  return {
    plan,
    weeks,
    progression,
  };
};
