import { computeRoundTrips } from "@/server/usecases/compute-round-trips";
import { serverEnv } from "@/shared/env/server-env";
import { appError, type AppError } from "@/shared/errors";
import { err, type Result } from "@/shared/result";
import {
  roundTripRequestSchema,
  type RoundTripResult,
} from "@/shared/types/round-trip";

/**
 * 周回路計算の入口。リクエストボディを検証し usecase を呼ぶ。
 */
export const roundTripHandler = async (
  rawBody: unknown,
): Promise<Result<RoundTripResult, AppError>> => {
  const parsed = roundTripRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return err(appError.validation("入力が不正です。", parsed.error.issues));
  }
  return computeRoundTrips(parsed.data, {
    overpassEndpoint: serverEnv.OVERPASS_ENDPOINT,
    userAgent: serverEnv.OVERPASS_USER_AGENT,
  });
};
