"use client";

import { useEffect, useState } from "react";

import {
  applyTheme,
  readStoredMode,
  storeMode,
  type ThemeMode,
} from "@/client/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; icon: React.JSX.Element }[] = [
  {
    mode: "system",
    label: "端末の設定に合わせる",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    mode: "light",
    label: "ライトモード",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    mode: "dark",
    label: "ダークモード",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

/**
 * テーマ（system / light / dark）の切替。選択は localStorage に保存し、OS 変更にも追従する。
 */
export const ThemeToggle = (): React.JSX.Element => {
  const [mode, setMode] = useState<ThemeMode>("system");

  // 初期マウントで保存済みモードを反映し、theme-color メタも実テーマへ同期する。
  useEffect(() => {
    const stored = readStoredMode();
    setMode(stored);
    applyTheme(stored);
  }, []);

  // mode=system のときだけ OS のテーマ変更に追従する。
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const select = (next: ThemeMode): void => {
    setMode(next);
    storeMode(next);
    applyTheme(next);
  };

  return (
    <div
      role="group"
      aria-label="テーマ切替"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-2 p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = mode === o.mode;
        return (
          <button
            key={o.mode}
            type="button"
            onClick={() => select(o.mode)}
            aria-label={o.label}
            aria-pressed={active}
            title={o.label}
            className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
              active
                ? "bg-accent text-accent-fg"
                : "text-muted hover:bg-surface-3 hover:text-fg"
            }`}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
};
