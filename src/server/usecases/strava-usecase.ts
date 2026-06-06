import {
  stravaRepository,
  type StravaTokens,
} from "@/server/repositories/strava-repository";
import { isStravaConfigured } from "@/shared/env/server-env";
import { appError, type AppError } from "@/shared/errors";
import { err, ok, type Result } from "@/shared/result";
import type { Activity } from "@/shared/types/training";

const NOT_CONFIGURED = appError.config(
  "Strava が未設定です（.env.local に STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET を設定してください）。",
);

/** Strava 連携のビジネスロジック。設定チェックと repository の呼び出しを束ねる。 */
export const stravaUsecase = {
  /** 連携が設定済みか（status 表示用）。 */
  isConfigured(): boolean {
    return isStravaConfigured();
  },

  /** 認可画面 URL を返す。未設定なら config エラー。 */
  authorizeUrl(redirectUri: string): Result<string, AppError> {
    if (!isStravaConfigured()) return err(NOT_CONFIGURED);
    return ok(stravaRepository.buildAuthorizeUrl(redirectUri));
  },

  /** 認可コードをトークンに交換する。route 側で refresh_token を Cookie 保存する。 */
  async connect(code: string): Promise<Result<StravaTokens, AppError>> {
    if (!isStravaConfigured()) return err(NOT_CONFIGURED);
    return stravaRepository.exchangeCode(code);
  },

  /**
   * 直近の活動を取得する。refresh_token はローテートし得るため、
   * 新しい refresh_token も併せて返し、route 側で Cookie を更新する。
   */
  async listActivities(
    refreshToken: string,
  ): Promise<Result<{ activities: Activity[]; refreshToken: string }, AppError>> {
    if (!isStravaConfigured()) return err(NOT_CONFIGURED);
    const tokens = await stravaRepository.refreshTokens(refreshToken);
    if (!tokens.ok) return err(tokens.error);
    const activities = await stravaRepository.fetchActivities(tokens.value.accessToken);
    if (!activities.ok) return err(activities.error);
    return ok({ activities: activities.value, refreshToken: tokens.value.refreshToken });
  },
};
