import { stravaRepository, type StravaTokens } from "@/server/repositories/strava-repository";
import { isStravaConfigured } from "@/shared/env/server-env";
import { appError, type AppError } from "@/shared/errors";
import { err, ok, type Result } from "@/shared/result";
import type { Activity, AthleteProfile } from "@/shared/types/training";

/**
 * listActivities の戻り。activities は best_efforts 畳み込み済み。
 */
export interface ListActivitiesResult {
  activities: Activity[];
  /**
   * アスリート情報・長期集計。取得失敗時は null（活動取得は成功扱いを維持）。
   */
  athlete: AthleteProfile | null;
  detailFetched: number;
  detailTruncated: boolean;
  refreshToken: string;
}

const NOT_CONFIGURED = appError.config(
  "Strava が未設定です（.env.local に STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET を設定してください）。"
);

/**
 * Strava 連携のビジネスロジック。設定チェックと repository の呼び出しを束ねる。
 */
export const stravaUsecase = {
  /**
   * 連携が設定済みか（status 表示用）。
   */
  isConfigured(): boolean {
    return isStravaConfigured();
  },

  /**
   * 認可画面 URL を返す。未設定なら config エラー。
   */
  authorizeUrl(redirectUri: string, state: string): Result<string, AppError> {
    if (!isStravaConfigured()) return err(NOT_CONFIGURED);
    return ok(stravaRepository.buildAuthorizeUrl(redirectUri, state));
  },

  /**
   * 認可コードをトークンに交換する。route 側で refresh_token を Cookie 保存する。
   */
  async connect(code: string): Promise<Result<StravaTokens, AppError>> {
    if (!isStravaConfigured()) return err(NOT_CONFIGURED);
    return stravaRepository.exchangeCode(code);
  },

  /**
   * 直近の活動を取得する。refresh_token はローテートし得るため、
   * 新しい refresh_token も併せて返し、route 側で Cookie を更新する。
   */
  async listActivities(refreshToken: string): Promise<Result<ListActivitiesResult, AppError>> {
    if (!isStravaConfigured()) return err(NOT_CONFIGURED);
    const tokens = await stravaRepository.refreshTokens(refreshToken);
    if (!tokens.ok) return err(tokens.error);
    const accessToken = tokens.value.accessToken;

    const fetched = await stravaRepository.fetchActivities(accessToken);
    if (!fetched.ok) return err(fetched.error);

    // アスリート情報は補助。取得に失敗しても活動取り込みは止めない（必須データではない）。
    const athleteResult = await stravaRepository.fetchAthleteProfile(accessToken);
    const athlete = athleteResult.ok ? athleteResult.value : null;

    return ok({
      activities: fetched.value.activities,
      athlete,
      detailFetched: fetched.value.detailFetched,
      detailTruncated: fetched.value.detailTruncated,
      refreshToken: tokens.value.refreshToken,
    });
  },
};
