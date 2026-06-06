import { serverEnv } from "@/shared/env/server-env";
import type { Activity } from "@/shared/types/training";

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const ACTIVITIES_URL = "https://www.strava.com/api/v3/athlete/activities";

export const STRAVA_REFRESH_COOKIE = "strava_rt";

/** 認可画面の URL。scope は活動の読み取り。 */
export function buildAuthorizeUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: serverEnv.STRAVA_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "activity:read_all",
    approval_prompt: "auto",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: serverEnv.STRAVA_CLIENT_ID ?? "",
      client_secret: serverEnv.STRAVA_CLIENT_SECRET ?? "",
      ...body,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Strava token エラー (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResponse;
}

/** 認可コードをトークンに交換。 */
export function exchangeCode(code: string): Promise<TokenResponse> {
  return postToken({ code, grant_type: "authorization_code" });
}

/** リフレッシュトークンでアクセストークンを更新（refresh_token はローテートし得る）。 */
export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
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
export function mapToActivities(raw: StravaActivity[]): Activity[] {
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

/** アクセストークンで直近の活動を取得して Activity[] にする。 */
export async function fetchActivities(
  accessToken: string,
  perPage = 100,
): Promise<Activity[]> {
  const url = `${ACTIVITIES_URL}?per_page=${perPage}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Strava activities エラー (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const raw = (await res.json()) as StravaActivity[];
  return mapToActivities(raw);
}
