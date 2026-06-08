import type { StravaTokens } from "@/server/repositories/strava-repository";
import { stravaUsecase, type ListActivitiesResult } from "@/server/usecases/strava-usecase";
import { appError, type AppError } from "@/shared/errors";
import { err, type Result } from "@/shared/result";

/** refresh_token を保存する Cookie 名（Cookie の読み書きは route 層が行う）。 */
export const STRAVA_REFRESH_COOKIE = "strava_rt";

/** 認可画面 URL を返す。 */
export function authorizeUrlHandler(redirectUri: string): Result<string, AppError> {
  return stravaUsecase.authorizeUrl(redirectUri);
}

/** コールバック。認可コード/エラーパラメータを検証し、トークン交換へ進む。 */
export async function connectHandler(
  code: string | null,
  errorParam: string | null
): Promise<Result<StravaTokens, AppError>> {
  if (errorParam) return err(appError.unauthorized("Strava 連携がキャンセルされました。"));
  if (!code) return err(appError.validation("認可コードがありません。"));
  return stravaUsecase.connect(code);
}

/** 直近の活動を取得。refresh_token 未保持なら未連携として扱う。 */
export async function listActivitiesHandler(
  refreshToken: string | undefined
): Promise<Result<ListActivitiesResult, AppError>> {
  if (!refreshToken) return err(appError.unauthorized("Strava 未連携です。"));
  return stravaUsecase.listActivities(refreshToken);
}

/** 連携状態（設定済みか / 接続済みか）。 */
export function statusHandler(hasRefreshCookie: boolean): {
  configured: boolean;
  connected: boolean;
} {
  return { configured: stravaUsecase.isConfigured(), connected: hasRefreshCookie };
}
