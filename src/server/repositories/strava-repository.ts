import { serverEnv } from "@/shared/env/server-env";
import { appError, type AppError } from "@/shared/errors";
import { err, ok, type Result, safeTry } from "@/shared/result";
import type {
  Activity,
  AthleteProfile,
  AthleteRunTotals,
  BestEffort,
  WorkoutKind,
} from "@/shared/types/training";

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";
const ACTIVITIES_URL = `${API_BASE}/athlete/activities`;

/**
 * best_efforts を詳細取得する上限。レート制限(100req/15分)に余裕を残す。
 */
const DETAIL_LIMIT = 18;
const EIGHT_WEEKS_MS = 56 * 86_400_000;

/**
 * Strava OAuth トークン（ドメイン型。外部レスポンスの snake_case はここで吸収）。
 */
export interface StravaTokens {
  accessToken: string;
  refreshToken: string;
  /**
   * 失効時刻（UNIX 秒）。
   */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  distance: number; // m
  moving_time: number; // s
  elapsed_time?: number; // s
  start_date_local: string;
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate?: boolean;
  total_elevation_gain?: number;
  average_speed?: number; // m/s
  max_speed?: number; // m/s
  average_cadence?: number; // rpm（ラン時は片脚）
  workout_type?: number | null;
  suffer_score?: number | null;
}

interface StravaActivityDetail {
  best_efforts?: {
    name: string;
    distance: number; // m
    elapsed_time: number; // s
    moving_time?: number; // s
  }[];
}

interface StravaAthlete {
  id: number;
  sex?: string;
  weight?: number; // kg
}

interface StravaRunTotals {
  distance: number; // m
  moving_time: number; // s
  count: number;
}

interface StravaStats {
  recent_run_totals?: StravaRunTotals;
  all_run_totals?: StravaRunTotals;
}

/**
 * ラン向け workout_type 分類。null/未指定は不明として undefined。
 */
const workoutKindOf = (wt: number | null | undefined): WorkoutKind | undefined => {
  switch (wt) {
    case 1:
      return "race";
    case 2:
      return "long";
    case 3:
      return "workout";
    case 0:
      return "default";
    default:
      return undefined;
  }
};

interface MappedActivity {
  id: number;
  activity: Activity;
}

/**
 * Strava の 1 活動を内部 Activity にマップ（ラン系・距離/時間ありのみ。それ以外は null）。
 */
const mapActivity = (a: StravaActivity): MappedActivity | null => {
  const kind = a.sport_type ?? a.type ?? "";
  if (!/run/i.test(kind)) return null;
  if (!(a.distance > 0) || !(a.moving_time > 0)) return null;
  const distanceKm = a.distance / 1000;
  const activity: Activity = {
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
  };
  if (a.elapsed_time != null) activity.elapsedSec = a.elapsed_time;
  if (a.has_heartrate != null) activity.hasHeartrate = a.has_heartrate;
  // Strava はラン時に片脚 rpm を返すため、歩/分にするには 2 倍する。
  if (a.average_cadence != null) activity.avgCadenceSpm = Math.round(a.average_cadence * 2);
  if (a.max_speed && a.max_speed > 0) activity.maxSpeedSecPerKm = Math.round(1000 / a.max_speed);
  const wk = workoutKindOf(a.workout_type);
  if (wk) activity.workoutKind = wk;
  if (a.suffer_score != null) activity.relativeEffort = a.suffer_score;
  return { id: a.id, activity };
};

/**
 * best_efforts を詳細取得する候補を選ぶ。
 * 直近8週・2km 以上のうち、レースを最優先、残りは速い順。VDOT 推定に効く走に限定。
 */
const selectDetailCandidates = (mapped: MappedActivity[], nowMs: number): MappedActivity[] => {
  const recent = mapped.filter(
    (m) =>
      m.activity.distanceKm >= 2 && nowMs - new Date(m.activity.date).getTime() <= EIGHT_WEEKS_MS
  );
  const races = recent.filter((m) => m.activity.workoutKind === "race");
  const rest = recent
    .filter((m) => m.activity.workoutKind !== "race")
    .sort(
      (a, b) => (a.activity.avgPaceSecPerKm ?? Infinity) - (b.activity.avgPaceSecPerKm ?? Infinity)
    );
  return [...races, ...rest];
};

const toRunTotals = (t: StravaRunTotals | undefined): AthleteRunTotals | undefined => {
  if (!t) return undefined;
  return { distanceKm: t.distance / 1000, durationSec: t.moving_time, count: t.count };
};

const postToken = async (body: Record<string, string>): Promise<Result<StravaTokens, AppError>> => {
  const fetched = await safeTry(() =>
    fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: serverEnv.STRAVA_CLIENT_ID ?? "",
        client_secret: serverEnv.STRAVA_CLIENT_SECRET ?? "",
        ...body,
      }).toString(),
    }));
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
};

/**
 * Bearer 認証付き GET の共通処理。接続・HTTP・JSON 解析を Result に正規化する。
 */
const getJson = async <T>(
  accessToken: string,
  url: string,
  what: string
): Promise<Result<T, AppError>> => {
  const fetched = await safeTry(() =>
    fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }));
  if (!fetched.ok) {
    return err(appError.upstream("Strava への接続に失敗しました。", fetched.error));
  }
  const res = fetched.value;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return err(
      appError.upstream(`Strava ${what}エラー (HTTP ${res.status}): ${text.slice(0, 200)}`)
    );
  }
  const parsed = await safeTry(() => res.json() as Promise<T>);
  if (!parsed.ok) {
    return err(appError.upstream(`Strava ${what}応答の解析に失敗しました。`, parsed.error));
  }
  return ok(parsed.value);
};

/**
 * 1 活動の best_efforts（最速 1k/5k/10k 等）を取得。
 */
const fetchBestEfforts = async (
  accessToken: string,
  id: number
): Promise<Result<BestEffort[], AppError>> => {
  const det = await getJson<StravaActivityDetail>(
    accessToken,
    `${API_BASE}/activities/${id}`,
    "活動詳細取得"
  );
  if (!det.ok) return err(det.error);
  const efforts: BestEffort[] = (det.value.best_efforts ?? [])
    .map((b) => ({
      name: b.name,
      distanceM: b.distance,
      timeSec: b.elapsed_time ?? b.moving_time ?? 0,
    }))
    .filter((b) => b.distanceM > 0 && b.timeSec > 0);
  return ok(efforts);
};

/**
 * アスリート情報(/athlete)と長期集計(/athletes/{id}/stats)を AthleteProfile にまとめる。
 */
const fetchAthleteProfile = async (
  accessToken: string
): Promise<Result<AthleteProfile, AppError>> => {
  const ath = await getJson<StravaAthlete>(accessToken, `${API_BASE}/athlete`, "アスリート取得");
  if (!ath.ok) return err(ath.error);
  const profile: AthleteProfile = {};
  if (typeof ath.value.weight === "number" && ath.value.weight > 0) {
    profile.weightKg = ath.value.weight;
  }
  if (ath.value.sex === "M" || ath.value.sex === "F") profile.sex = ath.value.sex;
  // 統計は補助。取れなくても weight/sex だけで profile を返す。
  const stats = await getJson<StravaStats>(
    accessToken,
    `${API_BASE}/athletes/${ath.value.id}/stats`,
    "統計取得"
  );
  if (stats.ok) {
    const recent = toRunTotals(stats.value.recent_run_totals);
    const all = toRunTotals(stats.value.all_run_totals);
    if (recent) profile.recentRunTotals = recent;
    if (all) profile.allRunTotals = all;
  }
  return ok(profile);
};

/**
 * 活動取得の結果。best_efforts 畳み込み済み活動と詳細取得の本数を返す。
 */
export interface FetchActivitiesResult {
  activities: Activity[];
  /**
   * best_efforts を実際に取得できた活動数。
   */
  detailFetched: number;
  /**
   * 詳細取得候補が上限を超え、一部のみ取得したか。
   */
  detailTruncated: boolean;
}

/**
 * Strava API（OAuth / 活動取得）への外部 I/O を担う repository。
 */
export const stravaRepository = {
  /**
   * 認可画面の URL。scope は活動の読み取り。
   * state は CSRF 対策の使い捨てトークン（呼び出し側が生成・cookie 保存・照合する）。
   */
  buildAuthorizeUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: serverEnv.STRAVA_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "activity:read_all",
      approval_prompt: "auto",
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  /**
   * 認可コードをトークンに交換。
   */
  exchangeCode(code: string): Promise<Result<StravaTokens, AppError>> {
    return postToken({ code, grant_type: "authorization_code" });
  },

  /**
   * リフレッシュトークンでアクセストークンを更新（refresh_token はローテートし得る）。
   */
  refreshTokens(refreshToken: string): Promise<Result<StravaTokens, AppError>> {
    return postToken({ refresh_token: refreshToken, grant_type: "refresh_token" });
  },

  /**
   * 直近の活動を取得し、内部 Activity[] にして返す。
   * VDOT 推定に効く一部の走（レース・速い走）には best_efforts を詳細取得して畳み込む。
   */
  async fetchActivities(
    accessToken: string,
    perPage = 100,
    nowMs: number = Date.now()
  ): Promise<Result<FetchActivitiesResult, AppError>> {
    const raw = await getJson<StravaActivity[]>(
      accessToken,
      `${ACTIVITIES_URL}?per_page=${perPage}`,
      "活動取得"
    );
    if (!raw.ok) return err(raw.error);

    const mapped = raw.value
      .map(mapActivity)
      .filter((m): m is MappedActivity => m !== null)
      .sort((x, y) => new Date(y.activity.date).getTime() - new Date(x.activity.date).getTime());

    const candidates = selectDetailCandidates(mapped, nowMs);
    const targets = candidates.slice(0, DETAIL_LIMIT);
    let detailFetched = 0;
    for (const m of targets) {
      const det = await fetchBestEfforts(accessToken, m.id);
      // 詳細は補助。失敗（レート制限等）したら以降を打ち切り、取得済み分で続行する。
      if (!det.ok) break;
      if (det.value.length > 0) {
        m.activity.bestEfforts = det.value;
        detailFetched++;
      }
    }

    return ok({
      activities: mapped.map((m) => m.activity),
      detailFetched,
      detailTruncated: candidates.length > DETAIL_LIMIT,
    });
  },

  /**
   * アスリート情報・長期集計を取得する。
   */
  fetchAthleteProfile(accessToken: string): Promise<Result<AthleteProfile, AppError>> {
    return fetchAthleteProfile(accessToken);
  },
};
