import { NextResponse } from "next/server";

import { authorizeUrlHandler } from "@/server/handlers/strava-handler";
import { serverEnv } from "@/shared/env/server-env";

export const runtime = "nodejs";

const baseUrl = (request: Request): string =>
  serverEnv.STRAVA_REDIRECT_BASE ?? new URL(request.url).origin;

/**
 * Strava 認可画面へリダイレクト。未設定なら案内付きで戻す。
 */
export const GET = async (request: Request): Promise<NextResponse> => {
  const base = baseUrl(request);
  const result = authorizeUrlHandler(`${base}/api/strava/callback`);
  if (!result.ok) {
    return NextResponse.redirect(new URL("/training?strava=unconfigured", base));
  }
  return NextResponse.redirect(result.value);
};
