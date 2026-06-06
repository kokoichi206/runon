import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { STRAVA_REFRESH_COOKIE } from "@/server/strava/strava";
import { isStravaConfigured } from "@/shared/env/server-env";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  return NextResponse.json({
    configured: isStravaConfigured(),
    connected: cookieStore.has(STRAVA_REFRESH_COOKIE),
  });
}
