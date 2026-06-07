import { NextResponse } from "next/server";

// サーバー側から公開 IP の概算位置を取得する（ブラウザ測位が使えない環境の代替）。
// localhost で動かす場合、取得されるのは開発マシンの公開 IP = 利用者の都市レベル位置。
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const res = await fetch("https://get.geojs.io/v1/ip/geo.json", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `IP 位置情報の取得に失敗しました (HTTP ${res.status})。` },
        { status: 502 }
      );
    }
    const j = (await res.json()) as {
      latitude?: string;
      longitude?: string;
      city?: string;
      country?: string;
    };
    const lat = Number(j.latitude);
    const lng = Number(j.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json({ error: "IP から位置を特定できませんでした。" }, { status: 502 });
    }
    return NextResponse.json({
      lat,
      lng,
      city: j.city ?? null,
      country: j.country ?? null,
      source: "ip",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: `IP 位置情報の取得に失敗しました: ${message}` },
      { status: 502 }
    );
  }
}
