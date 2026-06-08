import type { Metadata, Viewport } from "next";

import { SiteNav } from "@/client/components/SiteNav";
import { THEME_INIT_SCRIPT } from "@/client/lib/theme";
import { serverEnv } from "@/shared/env/server-env";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(serverEnv.SITE_URL ?? "http://localhost:3077"),
  applicationName: "runon",
  title: {
    default: "runon — 走るための周回路とトレーニング計画",
    template: "%s — runon",
  },
  description:
    "目標距離のループコースを地図生成し、レースまでのトレーニング計画を立てるランナー向けアプリ。OpenStreetMap ベースでキー不要・無料。",
  keywords: [
    "ランニング",
    "周回路",
    "ルート生成",
    "トレーニング計画",
    "GPX",
    "OpenStreetMap",
    "VDOT",
    "running",
    "route planner",
  ],
  authors: [{ name: "kokoichi206" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "runon",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "runon",
    title: "runon — 走るための周回路とトレーニング計画",
    description:
      "目標距離のループコースを地図生成し、レースまでの計画を立てる。OpenStreetMap ベースでキー不要。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "runon" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "runon",
    description: "走るための周回路とトレーニング計画。",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0e11" },
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* 初回描画前にテーマを確定し、ダーク/ライトのチラつきを防ぐ。 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <SiteNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
