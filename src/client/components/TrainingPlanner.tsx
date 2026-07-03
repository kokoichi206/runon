"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useTrainingStore } from "@/client/hooks/useTrainingStore";
import { parseActivities } from "@/client/lib/parse-activities";
import { generateTrainingPlanAction } from "@/server/handlers/actions/training";
import { type TrainingPlanResult } from "@/shared/training/compute-plan";
import { isoToYmdLocal } from "@/shared/training/date";
import { estimateFitness } from "@/shared/training/fitness";
import { trainingPaces, type ProgressionSummary } from "@/shared/training/paces";
import { summarizeByWeek } from "@/shared/training/plan";
import type {
  Fitness,
  PlannedWorkout,
  Race,
  TrainingPhase,
  TrainingPlanRequest,
  WorkoutSegment,
} from "@/shared/types/training";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const RACE_PRESETS = [
  {
    label: "5K",
    km: 5,
  },
  {
    label: "10K",
    km: 10,
  },
  {
    label: "ハーフ",
    km: 21.1,
  },
  {
    label: "フル",
    km: 42.2,
  },
];

const PHASE_LABEL: Record<TrainingPhase, string> = {
  base: "基礎",
  build: "構築",
  peak: "ピーク",
  taper: "調整",
  race: "レース",
};

const TYPE_STYLE: Record<string, string> = {
  rest: "text-faint",
  easy: "text-cat-easy",
  long: "text-cat-long font-semibold",
  tempo: "text-cat-hard font-semibold",
  interval: "text-cat-hard font-semibold",
  repetition: "text-cat-hard font-semibold",
  timeTrial: "text-cat-race font-bold",
  race: "text-cat-race font-bold",
};

const paceLabel = (secPerKm: number): string => {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

const kmLabel = (km: number): string => `${Math.round(km * 10) / 10}km`;

const SEG_REP_LABEL: Record<"threshold" | "interval" | "repetition", string> = {
  threshold: "T",
  interval: "I",
  repetition: "R",
};

const SEG_RUN_PREFIX: Record<"warmup" | "cooldown" | "steady" | "easy" | "long", string> = {
  warmup: "WU ",
  cooldown: "CD ",
  steady: "",
  easy: "",
  long: "",
};

/**
 * Daniels 式セッション（segments）を 1 行の人間可読文に変換する。
 * 例: "WU 1.5km + 5×1000m I @4:00/km（つなぎ 400m jog） + CD 1.5km"
 */
const describeSession = (segments: WorkoutSegment[]): string =>
  segments
    .map((s) => {
      if (s.kind === "run") {
        return `${SEG_RUN_PREFIX[s.role]}${kmLabel(s.distanceKm)}`;
      }
      return `${s.reps}×${s.repMeters}m ${SEG_REP_LABEL[s.role]} @${paceLabel(s.paceSecPerKm)}（つなぎ ${s.recoverMeters}m ${s.recoverKind}）`;
    })
    .join(" + ");

/**
 * "h:mm:ss" / "mm:ss" -> 秒。不正なら null。
 */
const parseClock = (s: string): number | null => {
  const parts = s
    .trim()
    .split(":")
    .map((p) => Number(p));
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) {
    return null;
  }
  const sec =
    parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
  return sec > 0 ? sec : null;
};

/**
 * 秒 -> "h:mm:ss" / "m:ss"。
 */
const formatClock = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

const todayYmd = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const mmddw = (ymd: string): string => {
  const [, m, d] = ymd.split("-");
  const wd = new Date(`${ymd}T00:00:00`).getDay();
  return `${m}/${d}(${WEEKDAYS[wd]})`;
};

export const TrainingPlanner = (): React.JSX.Element => {
  const store = useTrainingStore();
  // store オブジェクトは毎レンダリング新規生成されるが、各 setter は useCallback で安定。
  // 安定した参照を依存配列に使うため setter を分割代入する。
  const { setActivities } = store;
  const [today, setToday] = useState(todayYmd());
  const [csvError, setCsvError] = useState<string | null>(null);
  const [strava, setStrava] = useState({
    configured: false,
    connected: false,
  });
  const [stravaMsg, setStravaMsg] = useState<string | null>(null);
  const [stravaBusy, setStravaBusy] = useState(false);

  // レース入力フォーム。
  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [raceKm, setRaceKm] = useState(10);
  const [raceGoal, setRaceGoal] = useState(""); // "hh:mm:ss" 任意

  useEffect(() => {
    setToday(todayYmd());
  }, []);

  const importFromStrava = useCallback(async () => {
    setStravaBusy(true);
    try {
      const res = await fetch("/api/strava/activities");
      const j = await res.json();
      if (!res.ok) {
        setStravaMsg(j?.error ?? "Strava から取得できませんでした。");
        return;
      }
      store.setActivities(j.activities ?? []);
      store.setAthleteProfile(j.athlete ?? null);
      setStrava((s) => ({
        ...s,
        connected: true,
      }));
      const detail =
        j.detailFetched > 0
          ? `（うち ${j.detailFetched} 本は詳細取得${j.detailTruncated ? "・一部のみ" : ""}）`
          : "";
      setStravaMsg(
        `Strava から ${j.count ?? j.activities?.length ?? 0} 件取り込みました。${detail}`
      );
    } catch {
      setStravaMsg("Strava 取得に失敗しました。");
    } finally {
      setStravaBusy(false);
    }
  }, [store]);

  const disconnectStrava = useCallback(async () => {
    try {
      await fetch("/api/strava/activities", {
        method: "DELETE",
      });
    } catch {
      // ベストエフォート
    }
    setStrava((s) => ({
      ...s,
      connected: false,
    }));
    setStravaMsg("Strava 連携を解除しました。");
  }, []);

  // Strava の設定/連携状態を取得し、OAuth リダイレクト戻りを処理する。
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const res = await fetch("/api/strava/status");
        const j = await res.json();
        if (!cancelled) {
          setStrava({
            configured: !!j.configured,
            connected: !!j.connected,
          });
        }
      } catch {
        // 状態取得失敗は無視（未設定扱い）
      }
      const s = new URLSearchParams(window.location.search).get("strava");
      if (s) {
        if (s === "connected") {
          setStravaMsg("Strava と連携しました。取り込み中…");
          void importFromStrava();
        } else if (s === "unconfigured") {
          setStravaMsg("Strava が未設定です（.env.local にキーを設定）。");
        } else if (s === "denied") {
          setStravaMsg("Strava 連携がキャンセルされました。");
        } else {
          setStravaMsg("Strava 連携でエラーが発生しました。");
        }
        window.history.replaceState({}, "", "/training");
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [importFromStrava]);

  const fitness = useMemo(
    () =>
      estimateFitness(
        store.activities,
        new Date(`${today}T00:00:00`).getTime(),
        store.athleteProfile ?? undefined
      ),
    [store.activities, store.athleteProfile, today]
  );

  const selectedRace = useMemo(
    () => store.races.find((r) => r.id === store.selectedRaceId) ?? null,
    [store.races, store.selectedRaceId]
  );

  const availableDayCount = useMemo(
    () => store.availability.filter((d) => d.isPracticeDay && d.maxMinutes > 0).length,
    [store.availability]
  );

  // 計画生成はサービス境界（既定: Server Action）越しに行う。将来 LLM 等で重くなっても
  // UI を変えずに済むよう、結果は非同期で受け取る。fitness は軽量なのでローカルのまま。
  const [planResult, setPlanResult] = useState<TrainingPlanResult | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    // モードに応じてリクエストを組む。block はレース不要、race は選択中レースが要る。
    let req: TrainingPlanRequest | null = null;
    if (store.planMode === "block") {
      req = {
        mode: "block",
        today,
        weeks: store.blockWeeks,
        targetDistanceKm: store.targetDistanceKm,
        fitness,
        availability: store.availability,
        runsPerWeek: store.runsPerWeek,
        skippedDates: store.skippedDates,
      };
    } else if (selectedRace) {
      req = {
        mode: "race",
        today,
        race: selectedRace,
        fitness,
        availability: store.availability,
        runsPerWeek: store.runsPerWeek,
        skippedDates: store.skippedDates,
      };
    }
    if (!req) {
      setPlanResult(null);
      setPlanError(null);
      setPlanLoading(false);
      return;
    }
    const request = req;
    let cancelled = false;
    setPlanLoading(true);
    // 連続編集（曜日トグル / 週回数スライダー）でのサーバー往復を抑えるため軽くデバウンスする。
    const timer = setTimeout(() => {
      void generateTrainingPlanAction(request).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setPlanResult(result.value);
          setPlanError(null);
        } else {
          setPlanResult(null);
          setPlanError(result.error.message);
        }
        setPlanLoading(false);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    store.planMode,
    store.blockWeeks,
    store.targetDistanceKm,
    selectedRace,
    today,
    fitness,
    store.availability,
    store.runsPerWeek,
    store.skippedDates,
  ]);

  const plan: PlannedWorkout[] = planResult?.plan ?? [];
  const weeks = planResult?.weeks ?? [];
  const progression = planResult?.progression ?? null;
  // block は常にメニュー対象。race は選択中レースがある時のみ。
  const planActive = store.planMode === "block" || !!selectedRace;

  const onCsv = async (file: File) => {
    setCsvError(null);
    try {
      const text = await file.text();
      const acts = parseActivities(text);
      if (acts.length === 0) {
        setCsvError(
          "CSV から走行記録を読み取れませんでした（Garmin の Activities.csv 形式に対応）。"
        );
        return;
      }
      setActivities(acts);
    } catch {
      setCsvError("CSV の読み込みに失敗しました。");
    }
  };

  const onAddRace = () => {
    if (!raceName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(raceDate) || raceKm <= 0) return;
    const goalSec = raceGoal.trim() ? parseClock(raceGoal) : null;
    const race: Race = {
      id: crypto.randomUUID(),
      name: raceName.trim(),
      date: raceDate,
      distanceKm: raceKm,
      ...(goalSec
        ? {
            goalTimeSec: goalSec,
          }
        : {}),
    };
    store.addRace(race);
    setRaceName("");
    setRaceDate("");
    setRaceGoal("");
  };

  const totalKm = useMemo(
    () => Math.round(store.activities.reduce((s, a) => s + a.distanceKm, 0) * 10) / 10,
    [store.activities]
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:h-[calc(100dvh-var(--nav-h))] md:min-h-0 md:overflow-hidden md:py-4">
      <header className="mb-4 shrink-0">
        <h1 className="text-xl font-bold text-fg">トレーニング計画</h1>
        <p className="text-xs text-muted">目標レースまでの練習メニューを自動生成</p>
      </header>

      {/* デスクトップは左右カラムを独立スクロール（min-h-0 が無いと子が縮まずスクロールしない）。モバイルは通常の縦積み。 */}
      <div className="grid grid-cols-1 gap-5 md:min-h-0 md:flex-1 md:grid-cols-[360px_1fr] md:overflow-hidden">
        {/* 設定列 */}
        <div className="flex flex-col gap-5 md:h-full md:min-h-0 md:overflow-y-auto md:pr-1 md:pb-4">
          {/* 練習履歴 */}
          <section className="rounded-lg border border-border p-3">
            <h2 className="text-sm font-bold text-fg">1. 練習履歴（CSV / Strava）</h2>
            <div className="mt-2">
              {!strava.configured
                ? (
                    <p className="text-[11px] text-faint">
                      Strava 連携は未設定（.env.local に STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET
                      を設定で有効化）。
                    </p>
                  )
                : strava.connected
                  ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void importFromStrava()}
                          disabled={stravaBusy}
                          className="rounded border border-accent-soft-border bg-accent-soft px-2 py-1 text-xs font-semibold text-accent-soft-fg hover:brightness-105 disabled:opacity-50"
                        >
                          {stravaBusy ? "取り込み中…" : "Strava から取り込む"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void disconnectStrava()}
                          className="text-[11px] text-faint underline hover:text-muted"
                        >
                          解除
                        </button>
                      </div>
                    )
                  : (
                      <a
                        href="/api/strava/auth"
                        className="inline-block rounded border border-accent-soft-border bg-accent-soft px-2 py-1 text-xs font-semibold text-accent-soft-fg hover:brightness-105"
                      >
                        Strava と連携
                      </a>
                    )}
              {stravaMsg && <p className="mt-1 text-[11px] text-accent-soft-fg">{stravaMsg}</p>}
            </div>
            <label className="mt-2 block text-xs text-muted">
              または Garmin の Activities.csv をアップロード
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onCsv(f);
                }}
                className="mt-1 block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-accent file:px-2 file:py-1 file:text-accent-fg"
              />
            </label>
            {csvError && <p className="mt-1 text-[11px] text-danger-fg">{csvError}</p>}
            {store.activities.length > 0 && (
              <div className="mt-2 text-[11px] text-muted">
                <p>
                  {store.activities.length} 件 / 合計 {totalKm}km
                </p>
                <p className="mt-1 text-fg">
                  推定: 週{fitness.weeklyKm}km・最長{fitness.longestKm}km・ Eペース{" "}
                  {paceLabel(fitness.easyPaceSecPerKm)}
                </p>
                <p className="text-fg">
                  推定VO2max(VDOT) {fitness.currentVdot ?? "—"}・最大HR{" "}
                  {fitness.maxHrObserved ?? "—"}
                </p>
                {store.athleteProfile?.recentRunTotals && (
                  <p className="text-fg">
                    Strava集計 直近4週 週平均{" "}
                    {Math.round((store.athleteProfile.recentRunTotals.distanceKm / 4) * 10) / 10}
                    km
                  </p>
                )}
                {fitness.recentLoad && (
                  <p className="text-fg">
                    実測負荷 ACWR {fitness.recentLoad.ratio}
                    <span className="ml-1 text-faint">
                      (急性 {fitness.recentLoad.acute} / 慢性 {fitness.recentLoad.chronic})
                    </span>
                  </p>
                )}
                {fitness.recentLoad && fitness.recentLoad.ratio > 1.5 && (
                  <p
                    aria-live="polite"
                    className="mt-1 rounded border border-danger-fg/30 bg-danger-soft px-2 py-1 text-[11px] text-danger-fg"
                  >
                    注意: 直近の負荷が急増（ACWR {fitness.recentLoad.ratio}
                    ）。故障リスク帯のため、序盤は距離を控えめにしています。
                  </p>
                )}
                <div className="mt-2 max-h-40 overflow-y-auto rounded border border-hairline">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {store.activities.slice(0, 30).map((a, i) => (
                        <tr key={i} className="border-b border-hairline">
                          <td className="px-1 py-0.5 text-muted">
                            {isoToYmdLocal(a.date).slice(5)}
                          </td>
                          <td className="px-1 py-0.5">{a.distanceKm}km</td>
                          <td className="px-1 py-0.5 text-muted">
                            {a.avgPaceSecPerKm ? paceLabel(a.avgPaceSecPerKm) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* レース */}
          <section className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-fg">2. 目標</h2>
              <div
                className="flex rounded border border-border p-0.5 text-[11px]"
                role="group"
                aria-label="計画モード"
              >
                <button
                  type="button"
                  onClick={() => store.setPlanMode("race")}
                  className={`rounded px-2 py-0.5 ${
                    store.planMode === "race"
                      ? "bg-accent font-semibold text-accent-fg"
                      : "text-muted"
                  }`}
                >
                  目標レースから
                </button>
                <button
                  type="button"
                  onClick={() => store.setPlanMode("block")}
                  className={`rounded px-2 py-0.5 ${
                    store.planMode === "block"
                      ? "bg-accent font-semibold text-accent-fg"
                      : "text-muted"
                  }`}
                >
                  5km強化
                </button>
              </div>
            </div>

            {store.planMode === "block" && (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-[11px] text-muted">
                  目標レースを置かず、現在の走力(VDOT)から E/M/T/I/R
                  ペースで 5km を強化します。4 週ごとに 3000m TT を入れて VDOT を計測します。
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-fg">計画週数</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={52}
                    value={store.blockWeeks}
                    onChange={(e) => store.setBlockWeeks(Number(e.target.value))}
                    className="w-20 rounded border border-border px-2 py-1 text-base sm:text-sm"
                  />
                  <span className="text-xs text-muted">週（4週=1サイクル, 末に3000m TT）</span>
                </label>
                {fitness.currentVdot === null && (
                  <p
                    aria-live="polite"
                    className="rounded border border-warn/30 bg-warn-soft px-2 py-1 text-[11px] text-warn-fg"
                  >
                    現在 VDOT が未取得です。最初は易しい走と 3000m TT
                    のみ出します。TT を走って取り込むと、以降の強度走（T/I/R）のペースが入ります。
                  </p>
                )}
              </div>
            )}

            {store.planMode === "race" && (
              <>
                <div className="mt-2 flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="レース名"
                    value={raceName}
                    onChange={(e) => setRaceName(e.target.value)}
                    className="rounded border border-border px-2 py-1 text-base sm:text-sm"
                  />
                  <input
                    type="date"
                    value={raceDate}
                    min={today}
                    onChange={(e) => setRaceDate(e.target.value)}
                    className="rounded border border-border px-2 py-1 text-base sm:text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-1.5">
                    {RACE_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setRaceKm(p.km)}
                        className={`rounded border px-2 py-1 text-xs ${
                          raceKm === p.km
                            ? "border-accent bg-accent-soft text-accent-soft-fg"
                            : "border-border text-muted"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={raceKm}
                      onChange={(e) => setRaceKm(Number(e.target.value))}
                      className="w-20 rounded border border-border px-2 py-1 text-base sm:text-sm"
                    />
                    <span className="text-xs text-muted">km</span>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    目標タイム
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="任意 例 1:50:00 / 25:00"
                      value={raceGoal}
                      onChange={(e) => setRaceGoal(e.target.value)}
                      className="flex-1 rounded border border-border px-2 py-1 text-base sm:text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={onAddRace}
                    className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
                  >
                    レースを追加
                  </button>
                </div>
                {store.races.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {store.races.map((r) => (
                      <li key={r.id} className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => store.selectRace(r.id)}
                          className={`flex-1 rounded border px-2 py-1 text-left ${
                            r.id === store.selectedRaceId
                              ? "border-accent bg-accent-soft"
                              : "border-border"
                          }`}
                        >
                          {r.date} {r.name}（{r.distanceKm}km
                          {r.goalTimeSec ? ` / 目標 ${formatClock(r.goalTimeSec)}` : ""}）
                        </button>
                        <button
                          type="button"
                          onClick={() => store.removeRace(r.id)}
                          className="grid min-h-6 min-w-6 place-items-center rounded text-faint hover:bg-surface-2 hover:text-danger-fg"
                          aria-label="レースを削除"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>

          {/* 週間設定 */}
          <section className="rounded-lg border border-border p-3">
            <h2 className="text-sm font-bold text-fg">3. 週間設定（練習可能な曜日・確保時間）</h2>
            <p className="mt-1 text-[11px] text-muted">
              練習が可能な曜日にチェックし、その日に確保できる時間(分)を入れてください。
              下の「週の練習回数」だけを可能日の中から選びます（最も時間が取れる日をロング走に、残りは間隔が空くように）。
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <label htmlFor="runsPerWeek" className="font-semibold text-fg">
                週の練習回数
              </label>
              <select
                id="runsPerWeek"
                value={Math.min(store.runsPerWeek, Math.max(1, availableDayCount))}
                onChange={(e) => store.setRunsPerWeek(Number(e.target.value))}
                className="rounded border border-border px-2 py-1 text-base sm:text-sm"
              >
                {Array.from({
                  length: Math.max(1, availableDayCount),
                }, (_, i) => i + 1).map(
                  (n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  )
                )}
              </select>
              <span className="text-[11px] text-faint">回 / 可能日 {availableDayCount}日</span>
            </div>
            <div className="mt-2 flex flex-col gap-1">
              {store.availability.map((d, wd) => (
                <div key={wd} className="flex items-center gap-2 text-sm">
                  <label className="flex w-14 items-center gap-1">
                    <input
                      type="checkbox"
                      checked={d.isPracticeDay}
                      onChange={(e) =>
                        store.setAvailabilityDay(wd, {
                          isPracticeDay: e.target.checked,
                        })}
                    />
                    <span>{WEEKDAYS[wd]}</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={d.maxMinutes}
                    disabled={!d.isPracticeDay}
                    onChange={(e) =>
                      store.setAvailabilityDay(wd, {
                        maxMinutes: Number(e.target.value),
                      })}
                    className="w-20 rounded border border-border px-2 py-1 text-base sm:text-sm disabled:bg-surface-2"
                  />
                  <span className="text-xs text-muted">分</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 計画列 */}
        <div className="flex flex-col gap-3 md:h-full md:min-h-0 md:overflow-y-auto md:pr-1 md:pb-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-fg">4. 練習メニュー</h2>
            <button
              type="button"
              onClick={() => setToday(todayYmd())}
              className="rounded border border-accent-soft-border bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-soft-fg hover:brightness-105"
            >
              再計算（今日起点）
            </button>
          </div>

          {store.planMode === "race" && !selectedRace && (
            <p className="rounded border border-border bg-surface-2 p-4 text-sm text-muted">
              目標レースを追加・選択すると、ここに練習メニューが表示されます。
              レースを決めていなければ「5km強化」モードに切り替えてください。
            </p>
          )}

          {planActive && planLoading && plan.length === 0 && (
            <p
              className="rounded border border-border bg-surface-2 p-4 text-sm text-muted"
              aria-live="polite"
            >
              練習メニューを作成中…
            </p>
          )}

          {planActive && planError && (
            <p className="rounded border border-danger/30 bg-danger-soft p-4 text-sm text-danger-fg">
              {planError}
            </p>
          )}

          {store.planMode === "race" && selectedRace && !planLoading && !planError &&
            plan.length === 0 && (
            <p className="rounded border border-warn/30 bg-warn-soft p-4 text-sm text-warn-fg">
              選択中のレース日が過去です。未来の日付のレースを選んでください。
            </p>
          )}

          {store.planMode === "race" && selectedRace && plan.length > 0 && progression && (
            <ProgressionPanel progression={progression} />
          )}

          {store.planMode === "race" && selectedRace && plan.length > 0 &&
            !selectedRace.goalTimeSec && (
            <p className="rounded border border-border bg-surface-2 p-2 text-[11px] text-muted">
              レースに「目標タイム」を設定すると、目標から逆算したペース（VDOT）と、現状からの伸ばし方・実現可能性を表示します。
            </p>
          )}

          {store.planMode === "block" && plan.length > 0 && (
            <CurrentPacesPanel fitness={fitness} />
          )}

          {planActive && plan.length > 0 && (
            <PlanView
              plan={plan}
              weeks={weeks}
              today={today}
              doneDates={store.doneDates}
              skippedDates={store.skippedDates}
              onToggleDone={store.toggleDone}
              onToggleSkip={store.toggleSkip}
              onSkipWeek={store.skipWeek}
              fitness={fitness}
              race={store.planMode === "race" ? (selectedRace ?? undefined) : undefined}
            />
          )}
        </div>
      </div>

      <footer className="mt-6 shrink-0 text-[10px] text-faint md:mt-3">
        ※
        自動生成は一般的なヒューリスティックで、医学的・専門的助言ではありません。体調に応じて調整してください。
        設定はこのブラウザ（localStorage）に保存されます。
      </footer>
    </div>
  );
};

const FEASIBILITY_STYLE: Record<ProgressionSummary["feasibility"], string> = {
  現実的: "bg-success-soft text-success-fg",
  挑戦的: "bg-warn-soft text-warn-fg",
  厳しい: "bg-danger-soft text-danger-fg",
  不明: "bg-surface-3 text-muted",
};

const ProgressionPanel = ({
  progression: pr,
}: {
  progression: ProgressionSummary;
}): React.JSX.Element => {
  const zones: {
    label: string;
    sec: number;
  }[] = [
    {
      label: "E(イージー)",
      sec: pr.goalPaces.easy,
    },
    {
      label: "M(マラソン)",
      sec: pr.goalPaces.marathon,
    },
    {
      label: "T(閾値)",
      sec: pr.goalPaces.threshold,
    },
    {
      label: "I(速い)",
      sec: pr.goalPaces.interval,
    },
  ];
  return (
    <div className="rounded-lg border border-border p-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-fg">目標と伸ばし方</h3>
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${FEASIBILITY_STYLE[pr.feasibility]}`}
        >
          実現可能性: {pr.feasibility}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded border border-hairline p-2">
          <div className="text-muted">現状（推定）</div>
          <div className="font-semibold text-fg">
            {pr.currentVdot !== null ? `VDOT ${pr.currentVdot}` : "履歴不足"}
          </div>
          {pr.predictedCurrentTimeSec !== null && (
            <div className="text-muted">予測 {formatClock(pr.predictedCurrentTimeSec)}</div>
          )}
        </div>
        <div className="rounded border border-hairline p-2">
          <div className="text-muted">目標</div>
          <div className="font-semibold text-fg">{formatClock(pr.goalTimeSec)}</div>
          <div className="text-muted">VDOT {pr.goalVdot}</div>
        </div>
      </div>
      {pr.requiredImprovementPct !== null && pr.requiredImprovementPct > 0 && (
        <p className="mt-2 text-muted">
          目標まであと <b>{pr.requiredImprovementPct}%</b> のタイム短縮が必要（残り {pr.weeks}{" "}
          週）。
        </p>
      )}
      {pr.currentVdot === null && (
        <p className="mt-2 text-muted">CSV 履歴を取り込むと、現状からの差を表示できます。</p>
      )}
      <div className="mt-2">
        <div className="text-muted">目標達成に必要なペース（VDOT {pr.goalVdot}）</div>
        <div className="mt-1 grid grid-cols-4 gap-1 text-center">
          {zones.map((z) => (
            <div key={z.label} className="rounded bg-surface-2 p-1">
              <div className="text-[10px] text-faint">{z.label}</div>
              <div className="font-mono text-fg">{paceLabel(z.sec)}</div>
            </div>
          ))}
        </div>
      </div>
      {pr.currentPaces && (
        <p className="mt-1 text-[10px] text-faint">
          現状の閾値 {paceLabel(pr.currentPaces.threshold)} → 目標{" "}
          {paceLabel(pr.goalPaces.threshold)} へ、 build/peak のテンポ走で寄せていきます。
        </p>
      )}
      <p className="mt-2 text-[10px] text-faint">
        ※ VDOT(Jack
        Daniels)に基づく推定。実現可能性は残り週での妥当な改善幅との比較で、達成を保証するものではありません。
      </p>
    </div>
  );
};

/**
 * block モードの「現在の練習ペース」表示。現在 VDOT から E/M/T/I/R を出す。
 */
const CurrentPacesPanel = ({ fitness }: {
  fitness: Fitness;
}): React.JSX.Element => {
  const vdot = fitness.currentVdot;
  const paces = vdot !== null ? trainingPaces(vdot) : null;
  const zones = paces
    ? [
        {
          label: "E(イージー)",
          sec: paces.easy,
        },
        {
          label: "M(マラソン)",
          sec: paces.marathon,
        },
        {
          label: "T(閾値)",
          sec: paces.threshold,
        },
        {
          label: "I(速い)",
          sec: paces.interval,
        },
        {
          label: "R(最速)",
          sec: paces.repetition,
        },
      ]
    : [];
  return (
    <div className="rounded-lg border border-border p-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-fg">現在の練習ペース（5km 強化）</h3>
        <span className="rounded bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-fg">
          {vdot !== null ? `VDOT ${vdot}` : "VDOT 未取得"}
        </span>
      </div>
      {paces
        ? (
            <div className="mt-2 grid grid-cols-5 gap-1 text-center">
              {zones.map((z) => (
                <div key={z.label} className="rounded bg-surface-2 p-1">
                  <div className="text-[10px] text-faint">{z.label}</div>
                  <div className="font-mono text-fg tabular-nums">{paceLabel(z.sec)}</div>
                </div>
              ))}
            </div>
          )
        : (
            <p className="mt-2 text-muted">
              CSV / Strava を取り込むか、まず 3000m TT を走って取り込むと、E/M/T/I/R のペースが出ます。
            </p>
          )}
      <p className="mt-2 text-[10px] text-faint">
        ※ Jack Daniels の VDOT に基づく推定。R は表中域に合わせた近似です。
      </p>
    </div>
  );
};

interface PlanViewProps {
  plan: PlannedWorkout[];
  weeks: ReturnType<typeof summarizeByWeek>;
  today: string;
  doneDates: string[];
  skippedDates: string[];
  onToggleDone: (date: string) => void;
  onToggleSkip: (date: string) => void;
  onSkipWeek: (dates: string[]) => void;
  fitness: {
    easyPaceSecPerKm: number;
  };
  /**
   * 目標レース。block モード（レース無し）では undefined。
   */
  race?: Race;
}

const PlanView = ({
  plan,
  weeks,
  today,
  doneDates,
  skippedDates,
  onToggleDone,
  onToggleSkip,
  onSkipWeek,
  race,
}: PlanViewProps): React.JSX.Element => {
  const done = new Set(doneDates);
  const skip = new Set(skippedDates);
  const totalKm = Math.round(plan.reduce((s, w) => s + w.distanceKm, 0));

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-border bg-surface-2 p-2 text-xs text-muted">
        {race
          ? `${race.name}（${race.date} / ${race.distanceKm}km）まで ${weeks.length} 週・ 総距離 約${totalKm}km`
          : `5km 強化ブロック ${weeks.length} 週・ 総距離 約${totalKm}km`}
      </div>
      {weeks.map((wk) => {
        const days = plan.filter((p) => p.weekIndex === wk.weekIndex);
        return (
          <div key={wk.weekIndex} className="rounded-lg border border-border">
            <div className="flex items-center justify-between border-b border-hairline bg-surface-2 px-3 py-1.5">
              <span className="text-xs font-semibold text-fg">
                第{wk.weekIndex + 1}週
                <span className="ml-2 rounded bg-surface-3 px-1.5 text-[10px] text-muted">
                  {PHASE_LABEL[wk.phase]}
                </span>
              </span>
              <span className="flex items-center gap-2 text-[11px] text-muted">
                {wk.totalKm}km・{wk.totalMinutes}分・{wk.runDays}回
                <button
                  type="button"
                  onClick={() => onSkipWeek(days.map((d) => d.date))}
                  className="inline-flex min-h-6 items-center rounded border border-border px-1.5 py-0.5 text-muted hover:bg-surface-2"
                >
                  今週スキップ
                </button>
              </span>
            </div>
            <ul>
              {days.map((d) => {
                const isToday = d.date === today;
                const isDone = done.has(d.date);
                const isSkip = skip.has(d.date) || d.note === "スキップ（お休み）";
                return (
                  <li
                    key={d.date}
                    className={`flex items-center gap-2 border-l-4 px-3 py-1.5 text-sm ${
                      d.isKey ? "border-warn bg-warn-soft" : "border-transparent"
                    } ${isToday ? "bg-accent-soft" : ""}`}
                  >
                    <span className="w-20 text-xs text-muted">{mmddw(d.date)}</span>
                    <span
                      className={`w-24 ${TYPE_STYLE[d.type] ?? ""} ${isDone ? "line-through" : ""}`}
                    >
                      {d.title}
                      {d.isKey && (
                        <span className="ml-1 rounded bg-warn px-1 text-[9px] font-bold text-accent-fg align-middle">
                          ★
                        </span>
                      )}
                    </span>
                    <span className="flex-1 text-xs text-muted">
                      {d.type === "rest"
                        ? (
                            <span className="text-faint">{d.note ?? "休養"}</span>
                          )
                        : (
                            <>
                              {d.distanceKm}km・約{d.estMinutes}分
                              {d.paceSecPerKm && (
                                <span className="ml-1 text-faint">@{paceLabel(d.paceSecPerKm)}</span>
                              )}
                              {d.hrZone && (
                                <span
                                  className="ml-1 text-hr"
                                  title={d.hrBpmRange ? `${d.hrBpmRange} bpm` : undefined}
                                >
                                  Z{d.hrZone}
                                  {d.hrBpmRange ? `(${d.hrBpmRange})` : ""}
                                </span>
                              )}
                              {d.cappedByTime && <span className="ml-1 text-warn-fg">(時間調整)</span>}
                              {d.isKey && d.type !== "race" && (
                                <span className="ml-1 font-semibold text-warn-fg">
                                  ・今週のポイント
                                </span>
                              )}
                              {d.note && <span className="ml-1 text-faint">／{d.note}</span>}
                              {d.segments && (
                                <span className="mt-0.5 block text-[10px] text-faint">
                                  {describeSession(d.segments)}
                                </span>
                              )}
                            </>
                          )}
                    </span>
                    {d.type !== "rest" && d.type !== "race" && (
                      <>
                        <button
                          type="button"
                          onClick={() => onToggleDone(d.date)}
                          className={`inline-flex min-h-6 items-center rounded px-1.5 py-0.5 text-[11px] ${
                            isDone
                              ? "bg-success-soft text-success-fg"
                              : "border border-border text-muted hover:bg-surface-2"
                          }`}
                        >
                          完了
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleSkip(d.date)}
                          className={`inline-flex min-h-6 items-center rounded px-1.5 py-0.5 text-[11px] ${
                            isSkip
                              ? "bg-surface-3 text-muted"
                              : "border border-border text-muted hover:bg-surface-2"
                          }`}
                        >
                          スキップ
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
};
