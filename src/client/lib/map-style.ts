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
  ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}.png`);

export const mapStyle = (theme: ResolvedTheme): StyleSpecification => {
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
};

/**
 * ルート/マーカーの描画色。MapLibre の paint は CSS 変数を読めないため JS 側で持つ。
 * - palette: 比較モードで候補を識別する色（候補ごとに割り当て、地図とパネルで一致させる）
 * - ghost: フォーカスモードで非選択ルートを薄く描く色
 * 各テーマのタイル（dark/light）上でコントラストが出るよう色を分けている。
 */
export const MAP_COLORS: Record<
  ResolvedTheme,
  { marker: string; ghost: string; palette: string[] }
> = {
  dark: {
    marker: "#ff5a1f",
    ghost: "#6b7785",
    palette: ["#ff5a1f", "#22d3ee", "#a78bfa", "#34d399", "#ffb020", "#f472b6"],
  },
  light: {
    marker: "#d9480f",
    ghost: "#9b9186",
    palette: ["#d9480f", "#0e7490", "#7c3aed", "#047857", "#b5740a", "#be185d"],
  },
};

/**
 * 候補インデックスに対応するルート色（地図とパネルのスウォッチで共有）。
 */
export const routeColor = (theme: ResolvedTheme, index: number): string => {
  const p = MAP_COLORS[theme].palette;
  return p[index % p.length]!;
};
