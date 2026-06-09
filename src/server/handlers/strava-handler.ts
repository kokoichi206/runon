import type { StravaTokens } from "@/server/repositories/strava-repository";
import { stravaUsecase, type ListActivitiesResult } from "@/server/usecases/strava-usecase";
import { appError, type AppError } from "@/shared/errors";
import { err, type Result } from "@/shared/result";

/**
 * refresh_token を保存する Cookie 名（Cookie の読み書きは route 層が行う）。
 */
export const STRAVA_REFRESH_COOKIE = "strava_rt";

/**
 * 認可開始時に発行する CSRF 用 state を保存する Cookie 名。
 */
export const STRAVA_STATE_COOKIE = "strava_oauth_state";

/**
 * 認可画面 URL を返す。state は CSRF 照合用に呼び出し側が cookie 保存する。
 */
export const authorizeUrlHandler = (
  redirectUri: string,
  state: string
): Result<string, AppError> => {
  return stravaUsecase.authorizeUrl(redirectUri, state);
};

/**
 * コールバックの state が、認可開始時に発行した cookie の state と一致するか。
 * どちらか欠落（cookie 期限切れ・直リンクなど）も不正フローとして扱う。
 */
export const isCallbackStateValid = (
  cookieState: string | undefined,
  queryState: string | null
): boolean => {
  return Boolean(cookieState) && cookieState === queryState;
};

/**
 * コールバック。認可コード/エラーパラメータを検証し、トークン交換へ進む。
 */
export const connectHandler = async (
  code: string | null,
  errorParam: string | null
): Promise<Result<StravaTokens, AppError>> => {
  if (errorParam) return err(appError.unauthorized("Strava 連携がキャンセルされました。"));
  if (!code) return err(appError.validation("認可コードがありません。"));
  return stravaUsecase.connect(code);
};

/**
 * 直近の活動を取得。refresh_token 未保持なら未連携として扱う。
 */
export const listActivitiesHandler = async (
  refreshToken: string | undefined
): Promise<Result<ListActivitiesResult, AppError>> => {
  if (!refreshToken) return err(appError.unauthorized("Strava 未連携です。"));
  return stravaUsecase.listActivities(refreshToken);
};

/**
 * 連携状態（設定済みか / 接続済みか）。
 */
export const statusHandler = (
  hasRefreshCookie: boolean
): {
  configured: boolean;
  connected: boolean;
} => {
  return { configured: stravaUsecase.isConfigured(), connected: hasRefreshCookie };
};
