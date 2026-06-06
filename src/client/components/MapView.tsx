"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

import { MAP_COLORS, mapStyle } from "@/client/lib/map-style";
import type { ResolvedTheme } from "@/client/lib/theme";
import type { LngLat, RoundTripCandidate } from "@/shared/types/round-trip";

export interface MapViewProps {
  start: LngLat | null;
  candidates: RoundTripCandidate[];
  selectedId: string | null;
  /** 現在のテーマ。CARTO の light/dark タイルとルート色を切り替える。 */
  theme: ResolvedTheme;
  /** 地図クリックで始点を選ぶ。 */
  onPick: (lng: number, lat: number) => void;
}

const DEFAULT_CENTER: [number, number] = [139.767, 35.681]; // 東京駅
const ROUTES_ALL = "routes-all";
const ROUTE_GLOW = "route-glow";
const ROUTE_SELECTED = "route-selected";

function lineFeature(path: LngLat[]): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: path },
  };
}

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export default function MapView({
  start,
  candidates,
  selectedId,
  theme,
  onPick,
}: MapViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  // 現在の地図スタイルが反映しているテーマ。themeRef と食い違ったら setStyle で収束させる。
  const appliedThemeRef = useRef<ResolvedTheme | null>(null);

  // 最新の props を ref に保持し、地図再生成を避ける。
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const stateRef = useRef({ start, candidates, selectedId });
  stateRef.current = { start, candidates, selectedId };
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // ルート用のソース+レイヤーを（再）追加する。setStyle はカスタムレイヤーを消すため再投入に使う。
  const addRouteLayers = useRef((_map: maplibregl.Map) => {});
  addRouteLayers.current = (map) => {
    const c = MAP_COLORS[themeRef.current];
    if (!map.getSource(ROUTES_ALL)) {
      map.addSource(ROUTES_ALL, { type: "geojson", data: empty });
    }
    if (!map.getLayer(ROUTES_ALL)) {
      map.addLayer({
        id: ROUTES_ALL,
        type: "line",
        source: ROUTES_ALL,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": c.routeAlt, "line-width": 2, "line-opacity": 0.5 },
      });
    } else {
      map.setPaintProperty(ROUTES_ALL, "line-color", c.routeAlt);
    }

    if (!map.getSource(ROUTE_SELECTED)) {
      map.addSource(ROUTE_SELECTED, { type: "geojson", data: empty });
    }
    // 発光（太い半透明の下敷き）。
    if (!map.getLayer(ROUTE_GLOW)) {
      map.addLayer({
        id: ROUTE_GLOW,
        type: "line",
        source: ROUTE_SELECTED,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": c.routeSelected, "line-width": 12, "line-opacity": 0.25, "line-blur": 6 },
      });
    } else {
      map.setPaintProperty(ROUTE_GLOW, "line-color", c.routeSelected);
    }
    if (!map.getLayer(ROUTE_SELECTED)) {
      map.addLayer({
        id: ROUTE_SELECTED,
        type: "line",
        source: ROUTE_SELECTED,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": c.routeSelected, "line-width": 5, "line-opacity": 0.98 },
      });
    } else {
      map.setPaintProperty(ROUTE_SELECTED, "line-color", c.routeSelected);
    }
  };

  const render = useRef(() => {});
  render.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { start: s, candidates: cands, selectedId: sel } = stateRef.current;

    const allSrc = map.getSource(ROUTES_ALL) as maplibregl.GeoJSONSource | undefined;
    allSrc?.setData({
      type: "FeatureCollection",
      features: cands.map((c) => lineFeature(c.path)),
    });

    const selected = cands.find((c) => c.id === sel) ?? cands[0] ?? null;
    const selSrc = map.getSource(ROUTE_SELECTED) as maplibregl.GeoJSONSource | undefined;
    selSrc?.setData(selected ? lineFeature(selected.path) : empty);

    if (s) {
      if (!startMarkerRef.current) {
        startMarkerRef.current = new maplibregl.Marker({
          color: MAP_COLORS[themeRef.current].marker,
        });
      }
      startMarkerRef.current.setLngLat(s).addTo(map);
    } else {
      startMarkerRef.current?.remove();
    }

    if (selected && selected.path.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of selected.path) bounds.extend(p);
      map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 600 });
    } else if (s) {
      map.easeTo({ center: s, zoom: 14 });
    }
  };

  // 地図スタイルを現在のテーマへ収束させる（load 前後どちらの変更も取りこぼさない）。
  // 実際に setStyle を発行したら true を返す（styledata 経路で再描画されるため呼び出し側の render は不要）。
  const syncTheme = useRef((): boolean => false);
  syncTheme.current = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return false;
    if (appliedThemeRef.current === themeRef.current) return false;
    appliedThemeRef.current = themeRef.current;
    map.setStyle(mapStyle(themeRef.current));
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
    const builtTheme = themeRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(builtTheme),
      center: start ?? DEFAULT_CENTER,
      zoom: 14,
      // 既定（auto）: 狭幅では "i" ボタンに折りたたみ、広幅では帰属を展開表示。
      attributionControl: {},
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({}), "top-right");
    map.on("click", (e) => onPickRef.current(e.lngLat.lng, e.lngLat.lat));
    map.getCanvas().style.cursor = "crosshair";

    map.on("load", () => {
      readyRef.current = true;
      // 生成時に使ったテーマを記録し、その後に変わっていれば収束させる。
      appliedThemeRef.current = builtTheme;
      addRouteLayers.current(map);
      // テーマが食い違っていれば setStyle が走り、styledata 経路で再描画される。
      // その場合ここで render すると破棄されるソースに対する無駄打ちになるためスキップ。
      if (!syncTheme.current()) render.current();
    });

    return () => {
      readyRef.current = false;
      appliedThemeRef.current = null;
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
  }, [start, candidates, selectedId]);

  // テーマ変更でタイルスタイル/色を収束。
  useEffect(() => {
    syncTheme.current();
  }, [theme]);

  return <div ref={containerRef} className="h-full w-full" />;
}
