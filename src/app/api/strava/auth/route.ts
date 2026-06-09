import { NextResponse } from "next/server";

import { authorizeUrlHandler, STRAVA_STATE_COOKIE } from "@/server/handlers/strava-handler";
import { serverEnv } from "@/shared/env/server-env";

export const runtime = "nodejs";

const STATE_MAX_AGE = 60 * 10; // 認可往復の猶予（10分）

const baseUrl = (request: Request): string =>
  serverEnv.STRAVA_REDIRECT_BASE ?? new URL(request.url).origin;

/**
 * Strava 認可画面へリダイレクト。未設定なら案内付きで戻す。
 * 併せて CSRF 用 state を発行し cookie に保存する（callback で照合）。
 */
export const GET = async (request: Request): Promise<NextResponse> => {
  const base = baseUrl(request);
  const state = crypto.randomUUID();
  const result = authorizeUrlHandler(`${base}/api/strava/callback`, state);
  if (!result.ok) {
    return NextResponse.redirect(new URL("/training?strava=unconfigured", base));
  }
  const res = NextResponse.redirect(result.value);
  res.cookies.set(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE,
    secure: new URL(base).protocol === "https:",
  });
  return res;
};
