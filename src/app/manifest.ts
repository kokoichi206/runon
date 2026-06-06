import type { MetadataRoute } from "next";

/** PWA マニフェスト（/manifest.webmanifest）。ホーム追加・スタンドアロン起動に対応。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "runon — 走るための周回路とトレーニング計画",
    short_name: "runon",
    description:
      "目標距離のループコースを地図生成し、レースまでのトレーニング計画を立てる。OpenStreetMap ベースでキー不要。",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0e11",
    theme_color: "#0b0e11",
    categories: ["sports", "health", "navigation"],
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      {
        src: "/icons/icon-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
  };
}
