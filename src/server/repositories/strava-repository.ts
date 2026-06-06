import { appError, type AppError } from "@/shared/errors";
import { err, ok, type Result, safeTry } from "@/shared/result";
import { serverEnv } from "@/shared/env/server-env";
import type { Activity } from "@/shared/types/training";

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

/** Strava OAuth トークン（ドメイン型。外部レスポンスの snake_case はここで吸収）。 */
export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /** 失効時刻（UNIX 秒）。 */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface StravaActivity {
  name: string;
  type: string;
  sport_type?: string;
  distance: number; // m
  moving_time: number; // s
  start_date_local: string;
  average_heartrate?: number;
  max_heartrate?: number;
  total_elevation_gain?: number;
  average_speed?: number; // m/s
}

/** Strava の活動を内部 Activity[] にマップ（ラン系・距離/時間ありのみ）。 */
function mapToActivities(raw: StravaActivity[]): Activity[] {
  const out: Activity[] = [];
  for (const a of raw) {
    const kind = a.sport_type ?? a.type ?? "";
    if (!/run/i.test(kind)) continue;
    if (!(a.distance > 0) || !(a.moving_time > 0)) continue;
    const distanceKm = a.distance / 1000;
    out.push({
      date: a.start_date_local,
      type: "ラン",
      title: a.name ?? "",
      distanceKm,
      durationSec: a.moving_time,
      avgPaceSecPerKm:
        a.average_speed && a.average_speed > 0
          ? Math.round(1000 / a.average_speed)
          : Math.round(a.moving_time / distanceKm),
      avgHr: a.average_heartrate ?? null,
      maxHr: a.max_heartrate ?? null,
      ascentM: a.total_elevation_gain ?? null,
    });
  }
  out.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
  return out;
}

async function postToken(body: Record<string, string>): Promise<Result<StravaTokens, AppError>> {
  const fetched = await safeTry(() =>
    fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: serverEnv.STRAVA_CLIENT_ID ?? "",
        client_secret: serverEnv.STRAVA_CLIENT_SECRET ?? "",
        ...body,
      }).toString(),
    }),
  );
  if (!fetched.ok) {
    return err(appError.upstream("Strava への接続に失敗しました。", fetched.error));
  }
  const res = fetched.value;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return err(appError.upstream(`Strava 認証エラー (HTTP ${res.status}): ${text.slice(0, 200)}`));
  }
  const parsed = await safeTry(() => res.json() as Promise<TokenResponse>);
  if (!parsed.ok) {
    return err(appError.upstream("Strava トークン応答の解析に失敗しました。", parsed.error));
  }
  const t = parsed.value;
  return ok({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_at,
  });
}

/** Strava API（OAuth / 活動取得）への外部 I/O を担う repository。 */
export const stravaRepository = {
  /** 認可画面の URL。scope は活動の読み取り。 */
  buildAuthorizeUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: serverEnv.STRAVA_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "activity:read_all",
      approval_prompt: "auto",
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  /** 認可コードをトークンに交換。 */
  exchangeCode(code: string): Promise<Result<StravaTokens, AppError>> {
    return postToken({ code, grant_type: "authorization_code" });
  },

  /** リフレッシュトークンでアクセストークンを更新（refresh_token はローテートし得る）。 */
  refreshTokens(refreshToken: string): Promise<Result<StravaTokens, AppError>> {
    return postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
  },

  /** アクセストークンで直近の活動を取得し、内部 Activity[] にして返す。 */
  async fetchActivities(
    accessToken: string,
    perPage = 100,
  ): Promise<Result<Activity[], AppError>> {
    const fetched = await safeTry(() =>
      fetch(`${ACTIVITIES_URL}?per_page=${perPage}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    if (!fetched.ok) {
      return err(appError.upstream("Strava への接続に失敗しました。", fetched.error));
    }
    const res = fetched.value;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return err(appError.upstream(`Strava 活動取得エラー (HTTP ${res.status}): ${text.slice(0, 200)}`));
    }
    const parsed = await safeTry(() => res.json() as Promise<StravaActivity[]>);
    if (!parsed.ok) {
      return err(appError.upstream("Strava 活動応答の解析に失敗しました。", parsed.error));
    }
    return ok(mapToActivities(parsed.value));
  },
};
