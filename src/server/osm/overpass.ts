import type { LatLng } from "@/server/routing/geo";
import type { Profile } from "@/shared/types/round-trip";

/** Overpass `way ... out geom;` の要素。 */
export interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: { type: string }[];
}

/** プロファイル別の道路フィルタ（Overpass QL の way 条件）。 */
function highwayFilter(profile: Profile): string {
  // 徒歩/自転車のいずれでも自動車専用路や工事中などは除外する。
  const excludedHighway =
    "motorway|motorway_link|trunk|trunk_link|construction|proposed|abandoned|raceway|bus_guideway|escape|corridor|platform";
  const base =
    `way["highway"]["highway"!~"${excludedHighway}"]` +
    `["area"!~"yes"]["access"!~"private|no"]`;
  if (profile === "bike") {
    // 自転車禁止と歩行者専用路を除外。
    return `${base}["bicycle"!~"no"]["highway"!~"steps|footway|pedestrian"]`;
  }
  // walk: 歩行者禁止のみ除外。
  return `${base}["foot"!~"no"]`;
}

export function buildOverpassQuery(
  center: LatLng,
  radiusM: number,
  profile: Profile,
): string {
  const r = Math.round(radiusM);
  const lat = center.lat.toFixed(6);
  const lon = center.lng.toFixed(6);
  return [
    "[out:json][timeout:60];",
    "(",
    `  ${highwayFilter(profile)}(around:${r},${lat},${lon});`,
    ");",
    "out geom;",
  ].join("\n");
}

export interface OverpassFetchResult {
  ways: OverpassWay[];
  fetchMs: number;
}

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * Overpass から指定半径内の道路網を取得する。
 * - User-Agent 必須（OSM の利用エチケット）
 * - 429/504 は混雑。呼び出し側でメッセージ化する。
 */
export async function fetchStreetNetwork(
  center: LatLng,
  radiusM: number,
  profile: Profile,
  options: { endpoint?: string; userAgent?: string; signal?: AbortSignal } = {},
): Promise<OverpassFetchResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const userAgent =
    options.userAgent ??
    "fixed-length-round-trip/0.1 (https://github.com/kokoichi206/til; til research demo)";
  const query = buildOverpassQuery(center, radiusM, profile);

  const startedAt = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: options.signal,
  });
  const fetchMs = Date.now() - startedAt;

  if (res.status === 429 || res.status === 504) {
    throw new Error(
      `Overpass が混雑しています (HTTP ${res.status})。しばらく待つか半径(距離)を小さくして再試行してください。`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Overpass エラー (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as OverpassResponse;
  const ways = (json.elements ?? []).filter(
    (e): e is OverpassWay => e.type === "way",
  );
  return { ways, fetchMs };
}
