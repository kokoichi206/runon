import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  listActivitiesHandler,
  STRAVA_REFRESH_COOKIE,
} from "@/server/handlers/strava-handler";
import { httpStatusFor } from "@/shared/errors";

export const runtime = "nodejs";
export const maxDuration = 30;

const REFRESH_MAX_AGE = 60 * 60 * 24 * 365;

/** Strava の直近活動を取得して Activity[] を返す。refresh_token はローテートして保存し直す。 */
export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const result = await listActivitiesHandler(cookieStore.get(STRAVA_REFRESH_COOKIE)?.value);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.message },
      { status: httpStatusFor(result.error) },
    );
  }

  const { activities, refreshToken } = result.value;
  const res = NextResponse.json({ activities, count: activities.length });
  res.cookies.set(STRAVA_REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_MAX_AGE,
  });
  return res;
}

/** 連携解除（Cookie 削除）。 */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STRAVA_REFRESH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
