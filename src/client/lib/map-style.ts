import type { StyleSpecification } from "maplibre-gl";

import type { ResolvedTheme } from "@/client/lib/theme";

/**
 * キー不要の MapLibre スタイル（CARTO ラスタータイル）。
 * テーマに応じて light_all / dark_all を切り替える。CARTO Basemaps は無料・キー不要だが
 * 帰属表記（OpenStreetMap + CARTO）が必須。本番で多用する場合は CARTO の利用規約を確認すること。
 * 別タイル（独自/商用/Google）へ替えたい場合はこのファイルだけ差し替えればよい設計。
 */
const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

const cartoTiles = (variant: "light_all" | "dark_all"): string[] =>
  ["a", "b", "c", "d"].map(
    (s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`,
  );

export function mapStyle(theme: ResolvedTheme): StyleSpecification {
  const variant = theme === "dark" ? "dark_all" : "light_all";
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: cartoTiles(variant),
        tileSize: 256,
        attribution: CARTO_ATTRIBUTION,
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }],
  };
}

/** ルート/マーカーの描画色。MapLibre の paint は CSS 変数を読めないため JS 側で持つ。 */
export const MAP_COLORS: Record<
  ResolvedTheme,
  { routeSelected: string; routeAlt: string; marker: string }
> = {
  dark: { routeSelected: "#ff5a1f", routeAlt: "#ffb020", marker: "#ff5a1f" },
  light: { routeSelected: "#d9480f", routeAlt: "#b5740a", marker: "#d9480f" },
};
