import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  connectHandler,
  isCallbackStateValid,
  STRAVA_REFRESH_COOKIE,
  STRAVA_STATE_COOKIE,
} from "@/server/handlers/strava-handler";
import { serverEnv } from "@/shared/env/server-env";

export const runtime = "nodejs";

const baseUrl = (request: Request): string =>
  serverEnv.STRAVA_REDIRECT_BASE ?? new URL(request.url).origin;

const REFRESH_MAX_AGE = 60 * 60 * 24 * 365; // 1年

// 使い捨て state cookie を破棄するための失効指定。
const CLEAR_STATE = { httpOnly: true, path: "/", maxAge: 0 } as const;

/**
 * Strava からのコールバック。state を照合してから認可コードをトークンに交換し
 * refresh_token を Cookie 保存。state が一致しなければ CSRF として拒否する。
 */
export const GET = async (request: Request): Promise<NextResponse> => {
  const base = baseUrl(request);
  const url = new URL(request.url);
  const home = new URL("/training", base);

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STRAVA_STATE_COOKIE)?.value;
  if (!isCallbackStateValid(expectedState, url.searchParams.get("state"))) {
    home.searchParams.set("strava", "error");
    const res = NextResponse.redirect(home);
    res.cookies.set(STRAVA_STATE_COOKIE, "", CLEAR_STATE);
    return res;
  }

  const result = await connectHandler(url.searchParams.get("code"), url.searchParams.get("error"));
  if (!result.ok) {
    home.searchParams.set("strava", result.error.type === "unauthorized" ? "denied" : "error");
    const res = NextResponse.redirect(home);
    res.cookies.set(STRAVA_STATE_COOKIE, "", CLEAR_STATE);
    return res;
  }

  home.searchParams.set("strava", "connected");
  const res = NextResponse.redirect(home);
  res.cookies.set(STRAVA_REFRESH_COOKIE, result.value.refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_MAX_AGE,
    secure: url.protocol === "https:",
  });
  res.cookies.set(STRAVA_STATE_COOKIE, "", CLEAR_STATE);
  return res;
};
