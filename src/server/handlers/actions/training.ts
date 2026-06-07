"use server";

import { trainingPlanHandler } from "@/server/handlers/training-handler";
import type { AppError } from "@/shared/errors";
import type { Result } from "@/shared/result";
import type { TrainingPlanResult } from "@/shared/training/compute-plan";
import type { TrainingPlanRequest } from "@/shared/types/training";

/**
 * トレーニング計画生成の Server Action。client から直接呼べる裏側の入口。
 * 検証・生成は handler/usecase に委譲する（この層は transport のみ）。
 *
 * 注意: "use server" ファイルは async 関数のみ export 可能。
 */
export async function generateTrainingPlanAction(
  input: TrainingPlanRequest
): Promise<Result<TrainingPlanResult, AppError>> {
  return trainingPlanHandler(input);
}
