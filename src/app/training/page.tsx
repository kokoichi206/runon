"use client";

import dynamic from "next/dynamic";

// localStorage / Date に依存するためクライアント専用でロードする（SSR 無効）。
const TrainingPlanner = dynamic(
  () => import("@/client/components/TrainingPlanner").then((m) => m.TrainingPlanner),
  {
    ssr: false,
    loading: () => <div className="p-6 text-sm text-muted">読み込み中…</div>,
  }
);

export default function TrainingPage(): React.JSX.Element {
  return <TrainingPlanner />;
}
