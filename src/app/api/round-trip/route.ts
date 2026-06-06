import { NextResponse } from "next/server";

import {
  computeRoundTrips,
  RoundTripError,
} from "@/server/usecases/compute-round-trips";
import { serverEnv } from "@/shared/env/server-env";
import { roundTripRequestSchema } from "@/shared/types/round-trip";

// Overpass 取得 + 探索で数秒かかるため Node ランタイムで実行する。
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON ボディが不正です。" }, { status: 400 });
  }

  const parsed = roundTripRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "入力が不正です。", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await computeRoundTrips(parsed.data, {
      overpassEndpoint: serverEnv.OVERPASS_ENDPOINT,
      userAgent: serverEnv.OVERPASS_USER_AGENT,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RoundTripError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "不明なエラー";
    return NextResponse.json(
      { error: `計算に失敗しました: ${message}` },
      { status: 502 },
    );
  }
}
