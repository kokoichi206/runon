import { generateTrainingPlan } from "@/server/usecases/generate-training-plan";
import { appError, type AppError } from "@/shared/errors";
import { err, type Result } from "@/shared/result";
import type { TrainingPlanResult } from "@/shared/training/compute-plan";
import { trainingPlanRequestSchema } from "@/shared/types/training";

/** トレーニング計画生成の入口。入力を検証し usecase を呼ぶ。 */
export async function trainingPlanHandler(
  rawInput: unknown
): Promise<Result<TrainingPlanResult, AppError>> {
  const parsed = trainingPlanRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(appError.validation("入力が不正です。", parsed.error.issues));
  }
  return generateTrainingPlan(parsed.data);
}
