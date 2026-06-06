import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  statusHandler,
  STRAVA_REFRESH_COOKIE,
} from "@/server/handlers/strava-handler";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  return NextResponse.json(statusHandler(cookieStore.has(STRAVA_REFRESH_COOKIE)));
}
