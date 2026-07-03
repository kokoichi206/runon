"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

import { MAP_COLORS, mapStyle, type Basemap } from "@/client/lib/map-style";
import type { ResolvedTheme } from "@/client/lib/theme";
import type { LngLat, RoundTripCandidate } from "@/shared/types/round-trip";

/**
 * 候補の見せ方。compare=全候補を色分け / focus=選択ルートを強調し他はゴースト。
 */
export type RouteView = "compare" | "focus";

export interface MapViewProps {
  start: LngLat | null;
  candidates: RoundTripCandidate[];
  selectedId: string | null;
  view: RouteView;
  /**
   * 現在のテーマ。CARTO の light/dark タイルとルート色を切り替える。
   */
  theme: ResolvedTheme;
  /**
   * ベースマップ（地図 / 衛星写真）。
   */
  basemap: Basemap;
  /**
   * 地図クリックで始点を選ぶ。
   */
  onPick: (lng: number, lat: number) => void;
  /**
   * ルート（ループ）クリックでその候補を選ぶ。
   */
  onSelectRoute: (id: string) => void;
  /**
   * ベースマップ切替ボタンの操作。
   */
  onToggleBasemap: () => void;
}

const DEFAULT_CENTER: [number, number] = [139.767, 35.681]; // 東京駅
const ROUTES_SRC = "routes";
const ROUTE_GLOW = "routes-glow";
const ROUTE_LINE = "routes-line";
const empty: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export default function MapView({
  start,
  candidates,
  selectedId,
  view,
  theme,
  basemap,
  onPick,
  onSelectRoute,
  onToggleBasemap,
}: MapViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  // 現在の地図スタイルが反映している「テーマ:ベースマップ」。styleKey と食い違ったら setStyle で収束させる。
  const appliedStyleRef = useRef<string | null>(null);

  // 最新の props を ref に保持し、地図再生成を避ける。
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onSelectRouteRef = useRef(onSelectRoute);
  onSelectRouteRef.current = onSelectRoute;
  const stateRef = useRef({
    start,
    candidates,
    selectedId,
    view,
  });
  stateRef.current = {
    start,
    candidates,
    selectedId,
    view,
  };
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const styleKey = (): string => `${themeRef.current}:${basemapRef.current}`;

  // ルート用のソース+レイヤーを（再）追加する。setStyle はカスタムレイヤーを消すため再投入に使う。
  const addRouteLayers = useRef((_map: maplibregl.Map) => {});
  addRouteLayers.current = (map) => {
    if (!map.getSource(ROUTES_SRC)) {
      map.addSource(ROUTES_SRC, {
        type: "geojson",
        data: empty,
      });
    }
    // 発光（選択ルートの下敷き）。filter で selected のみ描く。
    if (!map.getLayer(ROUTE_GLOW)) {
      map.addLayer({
        id: ROUTE_GLOW,
        type: "line",
        source: ROUTES_SRC,
        filter: ["==", ["get", "selected"], true],
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 12,
          "line-blur": 6,
          "line-opacity": 0.22,
        },
      });
    }
    // 本線（色は feature の color、太さ/不透明度は view に応じて render で更新）。
    if (!map.getLayer(ROUTE_LINE)) {
      map.addLayer({
        id: ROUTE_LINE,
        type: "line",
        source: ROUTES_SRC,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.82,
        },
      });
    }
  };

  const render = useRef(() => {});
  render.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { start: s, candidates: cands, selectedId: sel, view: v } = stateRef.current;
    const colors = MAP_COLORS[themeRef.current];

    // 選択 id（未指定なら先頭）。
    const selId = (cands.find((c) => c.id === sel) ?? cands[0])?.id ?? null;

    const src = map.getSource(ROUTES_SRC) as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: cands.map((c, i) => ({
        type: "Feature",
        properties: {
          id: c.id,
          color: colors.palette[i % colors.palette.length],
          // 比較モードでは誰も選択扱いにしない（全候補を等しく表示）。
          selected: v === "focus" && c.id === selId,
        },
        geometry: {
          type: "LineString",
          coordinates: c.path,
        },
      })),
    });

    if (map.getLayer(ROUTE_LINE)) {
      if (v === "focus") {
        // 選択は自色、他はゴースト。
        map.setPaintProperty(ROUTE_LINE, "line-color", [
          "case",
          ["get", "selected"],
          ["get", "color"],
          colors.ghost,
        ]);
        map.setPaintProperty(ROUTE_LINE, "line-width", ["case", ["get", "selected"], 5, 2]);
        map.setPaintProperty(ROUTE_LINE, "line-opacity", ["case", ["get", "selected"], 1, 0.32]);
        map.setPaintProperty(ROUTE_GLOW, "line-opacity", 0.28);
      } else {
        // 比較：全候補を自色で。選択は少し太く。
        map.setPaintProperty(ROUTE_LINE, "line-color", ["get", "color"]);
        map.setPaintProperty(ROUTE_LINE, "line-width", ["case", ["get", "selected"], 5, 3]);
        map.setPaintProperty(ROUTE_LINE, "line-opacity", ["case", ["get", "selected"], 1, 0.82]);
        map.setPaintProperty(ROUTE_GLOW, "line-opacity", 0.18);
      }
    }

    if (s) {
      if (!startMarkerRef.current) {
        startMarkerRef.current = new maplibregl.Marker({
          color: colors.marker,
        });
      }
      startMarkerRef.current.setLngLat(s).addTo(map);
    } else {
      startMarkerRef.current?.remove();
    }

    // フィット：比較は全候補、フォーカスは選択ルートに合わせる。
    let bounds: maplibregl.LngLatBounds | null = null;
    if (v === "compare" && cands.length > 0) {
      bounds = new maplibregl.LngLatBounds();
      for (const c of cands) for (const p of c.path) bounds.extend(p);
    } else {
      const selPath = cands.find((c) => c.id === selId)?.path;
      if (selPath && selPath.length > 1) {
        bounds = new maplibregl.LngLatBounds();
        for (const p of selPath) bounds.extend(p);
      }
    }
    if (bounds) {
      map.fitBounds(bounds, {
        padding: 60,
        maxZoom: 16,
        duration: 600,
      });
    } else if (s) {
      map.easeTo({
        center: s,
        zoom: 14,
      });
    }
  };

  // 地図スタイルを現在のテーマ/ベースマップへ収束させる（load 前後どちらの変更も取りこぼさない）。
  // 実際に setStyle を発行したら true を返す（styledata 経路で再描画されるため呼び出し側の render は不要）。
  const syncStyle = useRef((): boolean => false);
  syncStyle.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return false;
    if (appliedStyleRef.current === styleKey()) return false;
    appliedStyleRef.current = styleKey();
    map.setStyle(mapStyle(themeRef.current, basemapRef.current));
    // マーカーは生成後に色を変えられないため作り直す。
    startMarkerRef.current?.remove();
    startMarkerRef.current = null;
    map.once("styledata", () => {
      addRouteLayers.current(map);
      render.current();
    });
    return true;
  };

  // 初回マウント：地図生成。
  useEffect(() => {
    if (!containerRef.current) return;
    const builtStyleKey = styleKey();
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(themeRef.current, basemapRef.current),
      center: start ?? DEFAULT_CENTER,
      zoom: 14,
      // 既定（auto）: 狭幅では "i" ボタンに折りたたみ、広幅では帰属を展開表示。
      attributionControl: {},
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    map.getCanvas().style.cursor = "crosshair";

    // クリック：ルート（ループ）に当たればその候補を選択、外せば始点設定。
    map.on("click", (e) => {
      const d = 6;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - d, e.point.y - d],
        [e.point.x + d, e.point.y + d],
      ];
      const hit = map.getLayer(ROUTE_LINE)
        ? map.queryRenderedFeatures(box, {
            layers: [ROUTE_LINE],
          })
        : [];
      const id = hit[0]?.properties?.id;
      if (id != null) {
        onSelectRouteRef.current(String(id));
        return;
      }
      onPickRef.current(e.lngLat.lng, e.lngLat.lat);
    });
    // ルート上はポインタ、それ以外は始点設定の crosshair。
    map.on("mouseenter", ROUTE_LINE, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", ROUTE_LINE, () => {
      map.getCanvas().style.cursor = "crosshair";
    });

    map.on("load", () => {
      readyRef.current = true;
      // 生成時に使ったスタイルを記録し、その後に変わっていれば収束させる。
      appliedStyleRef.current = builtStyleKey;
      addRouteLayers.current(map);
      // スタイルが食い違っていれば setStyle が走り、styledata 経路で再描画される。
      // その場合ここで render すると破棄されるソースに対する無駄打ちになるためスキップ。
      if (!syncStyle.current()) render.current();
    });

    return () => {
      readyRef.current = false;
      appliedStyleRef.current = null;
      startMarkerRef.current?.remove();
      startMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // 初回マウントのみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // props 変化で再描画。
  useEffect(() => {
    render.current();
  }, [start, candidates, selectedId, view]);

  // テーマ/ベースマップ変更でタイルスタイル/色を収束。
  useEffect(() => {
    syncStyle.current();
  }, [theme, basemap]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={onToggleBasemap}
        aria-pressed={basemap === "satellite"}
        className="absolute left-2 top-2 z-10 min-h-9 rounded-md border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-sm backdrop-blur transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {basemap === "satellite" ? "地図" : "衛星写真"}
      </button>
    </div>
  );
}
