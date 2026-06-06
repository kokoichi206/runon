import { NextResponse } from "next/server";

import { exchangeCode, STRAVA_REFRESH_COOKIE } from "@/server/strava/strava";
import { isStravaConfigured, serverEnv } from "@/shared/env/server-env";

export const runtime = "nodejs";

const baseUrl = (request: Request): string =>
  serverEnv.STRAVA_REDIRECT_BASE ?? new URL(request.url).origin;

const REFRESH_MAX_AGE = 60 * 60 * 24 * 365; // 1年

/** Strava からのコールバック。認可コードをトークンに交換し refresh_token を Cookie 保存。 */
export async function GET(request: Request): Promise<NextResponse> {
  const base = baseUrl(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const home = new URL("/training", base);

  if (error || !code || !isStravaConfigured()) {
    home.searchParams.set("strava", error ? "denied" : "error");
    return NextResponse.redirect(home);
  }

  try {
    const tok = await exchangeCode(code);
    home.searchParams.set("strava", "connected");
    const res = NextResponse.redirect(home);
    res.cookies.set(STRAVA_REFRESH_COOKIE, tok.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: REFRESH_MAX_AGE,
      secure: url.protocol === "https:",
    });
    return res;
  } catch {
    home.searchParams.set("strava", "error");
    return NextResponse.redirect(home);
  }
}
