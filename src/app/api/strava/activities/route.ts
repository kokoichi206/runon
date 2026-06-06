import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  fetchActivities,
  refreshAccessToken,
  STRAVA_REFRESH_COOKIE,
} from "@/server/strava/strava";
import { isStravaConfigured } from "@/shared/env/server-env";

export const runtime = "nodejs";
export const maxDuration = 30;

const REFRESH_MAX_AGE = 60 * 60 * 24 * 365;

/** Strava の直近活動を取得して Activity[] を返す。refresh_token はローテートして保存し直す。 */
export async function GET(): Promise<NextResponse> {
  if (!isStravaConfigured()) {
    return NextResponse.json({ error: "Strava が未設定です。" }, { status: 400 });
  }
  const cookieStore = await cookies();
  const rt = cookieStore.get(STRAVA_REFRESH_COOKIE)?.value;
  if (!rt) {
    return NextResponse.json({ error: "Strava 未連携です。" }, { status: 401 });
  }
  try {
    const tok = await refreshAccessToken(rt);
    const activities = await fetchActivities(tok.access_token);
    const res = NextResponse.json({ activities, count: activities.length });
    res.cookies.set(STRAVA_REFRESH_COOKIE, tok.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_MAX_AGE,
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "取得に失敗しました";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** 連携解除（Cookie 削除）。 */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STRAVA_REFRESH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
