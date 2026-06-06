"use client";

import { useEffect, useState } from "react";

import type { ResolvedTheme } from "@/client/lib/theme";

/**
 * 現在適用中の light/dark を購読する。
 * 誰が（ThemeToggle / OS 設定変更）テーマを変えても <html data-theme> の変化を
 * MutationObserver で拾うため、地図など命令的 UI を確実に追従させられる。
 */
export function useResolvedTheme(): ResolvedTheme {
  // 初期値を DOM（init スクリプトが確定済み）から同期読みし、初回レンダリングから正しい値にする。
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
      ? "light"
      : "dark",
  );

  useEffect(() => {
    const el = document.documentElement;
    const read = (): ResolvedTheme =>
      el.dataset.theme === "light" ? "light" : "dark";
    setTheme(read());

    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
