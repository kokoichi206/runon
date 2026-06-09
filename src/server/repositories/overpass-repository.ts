import type { LatLng } from "@/server/lib/routing/geo";
import { appError, type AppError } from "@/shared/errors";
import { err, ok, type Result, safeTry } from "@/shared/result";
import type { OverpassWay, Profile } from "@/shared/types/round-trip";

interface OverpassResponse {
  elements: { type: string; id?: number }[];
}

/**
 * プロファイル別の道路フィルタ（Overpass QL の way 条件）。
 * coarse=true（長距離）では走路価値の低い細道（駐車場通路 service・階段 steps・未舗装 track）も
 * 除外し、グラフの辺数を抑えて計算量を下げる（公園/河川敷の遊歩道 footway/path は温存）。
 */
const highwayFilter = (profile: Profile, coarse: boolean): string => {
  // 徒歩/自転車のいずれでも自動車専用路や工事中などは除外する。
  const baseExcluded =
    "motorway|motorway_link|trunk|trunk_link|construction|proposed|abandoned|raceway|bus_guideway|escape|corridor|platform";
  const excludedHighway = coarse ? `${baseExcluded}|service|track|steps` : baseExcluded;
  const base =
    `way["highway"]["highway"!~"${excludedHighway}"]` + `["area"!~"yes"]["access"!~"private|no"]`;
  if (profile === "bike") {
    // 自転車禁止と歩行者専用路を除外。
    return `${base}["bicycle"!~"no"]["highway"!~"steps|footway|pedestrian"]`;
  }
  // walk: 歩行者禁止のみ除外。
  return `${base}["foot"!~"no"]`;
};

export const buildOverpassQuery = (
  center: LatLng,
  radiusM: number,
  profile: Profile,
  coarse = false,
  withSignals = false
): string => {
  const r = Math.round(radiusM);
  const lat = center.lat.toFixed(6);
  const lon = center.lng.toFixed(6);
  const lines = [
    "[out:json][timeout:60];",
    "(",
    `  ${highwayFilter(profile, coarse)}(around:${r},${lat},${lon});`,
  ];
  if (withSignals) {
    lines.push(`  node["highway"="traffic_signals"](around:${r},${lat},${lon});`);
  }
  lines.push(");", "out geom;");
  return lines.join("\n");
};

export interface OverpassFetchResult {
  ways: OverpassWay[];
  fetchMs: number;
  /**
   * traffic_signals ノードの ID 集合（withSignals 時のみ非空）。
   */
  signalNodes: Set<number>;
}

export interface OverpassFetchOptions {
  endpoint?: string;
  userAgent?: string;
  signal?: AbortSignal;
  /**
   * 長距離向けに細道（service/track/steps）も除外して辺数を抑える。
   */
  coarse?: boolean;
  /**
   * 信号（traffic_signals）ノードも取得する（信号回避ルーティング用）。
   */
  withSignals?: boolean;
}

const DEFAULT_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_USER_AGENT = "runon/0.1 (https://github.com/kokoichi206/runon; round-trip generator)";

/**
 * Overpass API（道路網取得）への外部 I/O を担う repository。
 */
export const overpassRepository = {
  /**
   * 指定半径内の道路網を取得する。
   * - User-Agent 必須（OSM の利用エチケット）
   * - 429/504 は混雑、その他の非 2xx・ネットワーク失敗も upstream エラーとして返す
   */
  async fetchStreetNetwork(
    center: LatLng,
    radiusM: number,
    profile: Profile,
    options: OverpassFetchOptions = {}
  ): Promise<Result<OverpassFetchResult, AppError>> {
    const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    const query = buildOverpassQuery(
      center,
      radiusM,
      profile,
      options.coarse ?? false,
      options.withSignals ?? false
    );

    const startedAt = Date.now();
    const fetched = await safeTry(() =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: options.signal,
      })
    );
    const fetchMs = Date.now() - startedAt;
    if (!fetched.ok) {
      return err(appError.upstream("Overpass への接続に失敗しました。", fetched.error));
    }
    const res = fetched.value;

    if (res.status === 429 || res.status === 504) {
      return err(
        appError.upstream(
          `Overpass が混雑しています (HTTP ${res.status})。しばらく待つか距離を小さくして再試行してください。`
        )
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return err(appError.upstream(`Overpass エラー (HTTP ${res.status}): ${body.slice(0, 200)}`));
    }

    const parsed = await safeTry(() => res.json() as Promise<OverpassResponse>);
    if (!parsed.ok) {
      return err(appError.upstream("Overpass 応答の解析に失敗しました。", parsed.error));
    }
    const elements = parsed.value.elements ?? [];
    const ways = elements.filter((e): e is OverpassWay => e.type === "way");
    const signalNodes = new Set<number>();
    for (const e of elements) {
      if (e.type === "node" && typeof e.id === "number") signalNodes.add(e.id);
    }
    return ok({ ways, fetchMs, signalNodes });
  },
};
