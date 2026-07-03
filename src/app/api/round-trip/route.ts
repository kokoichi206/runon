import { NextResponse } from "next/server";

import { roundTripHandler } from "@/server/handlers/round-trip-handler";
import { httpStatusFor } from "@/shared/errors";

// Overpass 取得 + 探索で数秒かかるため Node ランタイムで実行する。
export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = async (request: Request): Promise<NextResponse> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({
      error: "JSON ボディが不正です。",
    }, {
      status: 400,
    });
  }

  const result = await roundTripHandler(body);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error.message,
      },
      {
        status: httpStatusFor(result.error),
      }
    );
  }
  return NextResponse.json(result.value);
};
