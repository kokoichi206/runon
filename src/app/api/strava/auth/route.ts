import { NextResponse } from "next/server";

import { buildAuthorizeUrl } from "@/server/strava/strava";
import { isStravaConfigured, serverEnv } from "@/shared/env/server-env";

export const runtime = "nodejs";

const baseUrl = (request: Request): string =>
  serverEnv.STRAVA_REDIRECT_BASE ?? new URL(request.url).origin;

/** Strava 認可画面へリダイレクト。未設定なら案内付きで戻す。 */
export async function GET(request: Request): Promise<NextResponse> {
  const base = baseUrl(request);
  if (!isStravaConfigured()) {
    return NextResponse.redirect(new URL("/training?strava=unconfigured", base));
  }
  const redirectUri = `${base}/api/strava/callback`;
  return NextResponse.redirect(buildAuthorizeUrl(redirectUri));
}
