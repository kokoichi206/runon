import { NextResponse } from "next/server";

import {
  connectHandler,
  STRAVA_REFRESH_COOKIE,
} from "@/server/handlers/strava-handler";
import { serverEnv } from "@/shared/env/server-env";

export const runtime = "nodejs";

const baseUrl = (request: Request): string =>
  serverEnv.STRAVA_REDIRECT_BASE ?? new URL(request.url).origin;

const REFRESH_MAX_AGE = 60 * 60 * 24 * 365; // 1年

/** Strava からのコールバック。認可コードをトークンに交換し refresh_token を Cookie 保存。 */
export async function GET(request: Request): Promise<NextResponse> {
  const base = baseUrl(request);
  const url = new URL(request.url);
  const home = new URL("/training", base);

  const result = await connectHandler(
    url.searchParams.get("code"),
    url.searchParams.get("error"),
  );
  if (!result.ok) {
    home.searchParams.set("strava", result.error.type === "unauthorized" ? "denied" : "error");
    return NextResponse.redirect(home);
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
  return res;
}
