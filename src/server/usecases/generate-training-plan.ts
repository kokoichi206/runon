import { appError, type AppError } from "@/shared/errors";
import { err, ok, safeTry, type Result } from "@/shared/result";
import { computeTrainingPlan, type TrainingPlanResult } from "@/shared/training/compute-plan";
import type { TrainingPlanRequest } from "@/shared/types/training";

/**
 * トレーニング計画生成のユースケース。
 *
 * 現状は共有の純粋ロジック（computeTrainingPlan）を実行するだけだが、
 * 将来は LLM による各メニューの言語化・調整や、重い最適化をここで合成する想定。
 * そのため戻り値は Result + 非同期に固定し、呼び出し側の契約を今のうちに確定させる。
 */
export const generateTrainingPlan = async (
  req: TrainingPlanRequest
): Promise<Result<TrainingPlanResult, AppError>> => {
  const computed = await safeTry(() => computeTrainingPlan(req));
  if (!computed.ok) {
    return err(appError.internal("トレーニング計画の生成に失敗しました。", computed.error));
  }
  return ok(computed.value);
};
