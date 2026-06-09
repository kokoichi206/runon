"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { useResolvedTheme } from "@/client/hooks/useResolvedTheme";
import { useRoundTrip } from "@/client/hooks/useRoundTrip";
import { routeColor, type Basemap } from "@/client/lib/map-style";
import type { LngLat } from "@/shared/types/round-trip";

/**
 * 候補の見せ方。compare=全候補を比較 / focus=選択した1本に集中。
 */
type RouteView = "compare" | "focus";

/**
 * ボトムシートの段階。peek=つまみのみ / mid=半分 / full=ほぼ全面。
 */
type SheetSnap = "peek" | "mid" | "full";

const MapView = dynamic(() => import("@/client/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface-2 text-muted">
      地図を読み込み中…
    </div>
  ),
});

interface Preset {
  label: string;
  lat: number;
  lng: number;
}

const PRESETS: Preset[] = [
  { label: "東京駅", lat: 35.681, lng: 139.767 },
  { label: "京都駅", lat: 34.985, lng: 135.758 },
  { label: "セントラルパーク(NY)", lat: 40.7829, lng: -73.9654 },
  { label: "カーディフ(英)", lat: 51.4816, lng: -3.1791 },
];

const HOME_KEY = "flrt:home";

interface HomeLocation {
  lat: number;
  lng: number;
}

// 経路の「形を決める点」を最大 k 個選ぶ（Ramer–Douglas–Peucker の貪欲版）。
// 等間隔サンプルより曲がり角を残せるため、Google の再探索でも本来の道を辿りやすい。
const simplifyToK = (path: LngLat[], k: number): LngLat[] => {
  const n = path.length;
  if (n <= k) return path;
  // 緯度経度を近似的に平面化（perpendicular 距離計算用）。
  const latRef = (path[0]![1] * Math.PI) / 180;
  const proj = ([lng, lat]: LngLat): [number, number] => [
    lng * Math.cos(latRef) * 111_320,
    lat * 111_320,
  ];
  const pts = path.map(proj);
  const perp = (i: number, a: number, b: number): number => {
    const [px, py] = pts[i]!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = ((px - ax) * dx + (py - ay) * dy) / len2;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  };
  const keep = new Set<number>([0, n - 1]);
  while (keep.size < k) {
    const sorted = [...keep].sort((a, b) => a - b);
    let bestIdx = -1;
    let bestDist = -1;
    for (let s = 0; s + 1 < sorted.length; s++) {
      const a = sorted[s]!;
      const b = sorted[s + 1]!;
      for (let i = a + 1; i < b; i++) {
        const d = perp(i, a, b);
        if (d > bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }
    if (bestIdx < 0) break;
    keep.add(bestIdx);
  }
  return [...keep].sort((a, b) => a - b).map((i) => path[i]!);
};

/**
 * 計算した周回路を Google マップ（経路モード・徒歩）で開く URL を作る。
 * Maps URLs はキー不要だが waypoint は実用上 ~9 個まで。
 * 「曲がり角」を優先選択(simplifyToK)して渡すことで再探索の精度を上げる。
 * それでも Google が点間を自前データで補うため「近似」になる（完全一致は GPX で）。
 */
const googleMapsDirUrl = (start: LngLat, path: LngLat[], maxWaypoints = 9): string => {
  const ll = ([lngV, latV]: LngLat) => `${latV.toFixed(6)},${lngV.toFixed(6)}`;
  const origin = ll(start);
  // 始点・終点(=start)を含めて簡約し、中間の形状点だけ waypoint にする。
  const shape = simplifyToK(path, maxWaypoints + 2);
  const picks = shape.slice(1, -1);
  const waypoints = picks.map(ll).join("|");
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination: origin, // 周回路なので始点に戻る
    travelmode: "walking",
  });
  // waypoints は URLSearchParams だと | が %7C になる。Google はどちらも解釈する。
  const wp = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
  return `https://www.google.com/maps/dir/?${params.toString()}${wp}`;
};

const escapeXml = (s: string): string =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!
  );

/**
 * 経路を GPX(トラック) 文字列にする。全点をそのまま出力＝正確な経路。
 */
const toGpx = (path: LngLat[], name: string): string => {
  const pts = path
    .map(([lng, lat]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="Running Planner" xmlns="http://www.topografix.com/GPX/1/1">` +
    `<trk><name>${escapeXml(name)}</name><trkseg>${pts}</trkseg></trk></gpx>`
  );
};

/**
 * GPX をダウンロードさせる。
 */
const downloadGpx = (path: LngLat[], name: string): void => {
  const blob = new Blob([toGpx(path, name)], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * GPX をスマホの共有シートに出す（Web Share API）。OsmAnd/Komoot/AirDrop 等へ直接渡せる。
 * 共有が使えない環境（多くの PC）ではダウンロードにフォールバック。
 */
const shareGpx = async (path: LngLat[], name: string): Promise<void> => {
  const file = new File([toGpx(path, name)], `${name}.gpx`, {
    type: "application/gpx+xml",
  });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name, text: "ランニングコース(GPX)" });
      return;
    } catch (err) {
      // ユーザーがキャンセルした場合は何もしない。それ以外は保存にフォールバック。
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  downloadGpx(path, name);
};

export const RoundTripPlanner = (): React.JSX.Element => {
  const [lat, setLat] = useState(35.681);
  const [lng, setLng] = useState(139.767);
  const [targetKm, setTargetKm] = useState(3);
  // 信号・曲がりの少ない経路を優先する（生成に信号ペナルティ、並べ替えにも反映）。
  const [avoidSignals, setAvoidSignals] = useState(false);
  // 細い道（路地・遊歩道など）を避けた経路を優先する（生成に細道ペナルティ、並べ替えにも反映）。
  const [avoidNarrowRoads, setAvoidNarrowRoads] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>("map");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<RouteView>("compare");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  const [home, setHome] = useState<HomeLocation | null>(null);
  const [homeNote, setHomeNote] = useState<string | null>(null);

  const { state, run } = useRoundTrip();
  const theme = useResolvedTheme();
  // モバイルのボトムシート段階。初期は full（設定が見える状態）。
  const [snap, setSnap] = useState<SheetSnap>("full");
  // md 以上はサイドバー（常時表示）。シートの折りたたみ判定（inert 適用）に使う。
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = (): void => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // ドラッグでシートを translateY 移動し、離すと最寄りの段（peek/mid/full）にスナップする。
  const sheetRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  // peek 位置 = 全高からハンドル分を引いた量（ハンドルだけ残して下へ隠す）。実測で算出。
  const [closedOffset, setClosedOffset] = useState(0);
  // ドラッグ中の translateY（px）。null のときは snap に従う。
  const [dragY, setDragY] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; base: number } | null>(null);
  const didDrag = useRef(false);

  useEffect(() => {
    const sheet = sheetRef.current;
    const handle = handleRef.current;
    if (!sheet || !handle) return;
    const measure = (): void =>
      setClosedOffset(Math.max(0, sheet.offsetHeight - handle.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, []);

  // 各段の translateY。full=0（最も開く）/ peek=closedOffset（最も閉じる）/ mid=その間。
  const MID_RATIO = 0.45;
  const snapOffset = (s: SheetSnap): number =>
    s === "full" ? 0 : s === "peek" ? closedOffset : Math.round(closedOffset * MID_RATIO);
  const nearestSnap = (offset: number): SheetSnap =>
    (["full", "mid", "peek"] as SheetSnap[]).reduce((best, s) =>
      Math.abs(snapOffset(s) - offset) < Math.abs(snapOffset(best) - offset) ? s : best
    );

  const onHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (isDesktop) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { y: e.clientY, base: snapOffset(snap) };
    didDrag.current = false;
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const start = dragStart.current;
    if (!start) return;
    if (Math.abs(e.clientY - start.y) > 6) didDrag.current = true;
    setDragY(Math.min(closedOffset, Math.max(0, start.base + (e.clientY - start.y))));
  };
  const onHandlePointerEnd = (e: React.PointerEvent<HTMLButtonElement>): void => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start && didDrag.current) {
      const at = Math.min(closedOffset, Math.max(0, start.base + (e.clientY - start.y)));
      setSnap(nearestSnap(at)); // 離した位置に最も近い段へ
    }
    setDragY(null);
  };
  // タップ（ドラッグなし）は full ↔ peek を行き来（mid へはドラッグで）。
  const onHandleClick = (): void => {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    setSnap((s) => (s === "full" ? "peek" : "full"));
  };

  // シートの translateY。デスクトップ（静的サイドバー）では変形しない。
  const sheetTranslate = isDesktop ? null : (dragY ?? snapOffset(snap));

  useEffect(() => {
    if (state.status === "success") {
      setSelectedId(state.result.recommendedId);
      // まず全候補を見比べられる「比較」から始める。
      setView("compare");
    }
  }, [state]);

  // 保存済みの自宅を localStorage から読み込む（クライアントのみ）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HOME_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as HomeLocation).lat === "number" &&
        typeof (parsed as HomeLocation).lng === "number"
      ) {
        setHome({
          lat: (parsed as HomeLocation).lat,
          lng: (parsed as HomeLocation).lng,
        });
      }
    } catch {
      // localStorage 不可（プライベートモード等）。自宅機能は無効になるが他は動作継続。
    }
  }, []);

  const saveHome = () => {
    const h: HomeLocation = { lat, lng };
    try {
      localStorage.setItem(HOME_KEY, JSON.stringify(h));
      setHome(h);
      setHomeNote(`自宅を登録しました（${lat.toFixed(5)}, ${lng.toFixed(5)}）。`);
    } catch {
      setHomeNote("自宅を保存できませんでした（ブラウザの保存機能が無効です）。");
    }
  };

  const useHome = () => {
    if (!home) return;
    setLat(home.lat);
    setLng(home.lng);
    setGeoError(null);
    setGeoNote(null);
  };

  const clearHome = () => {
    try {
      localStorage.removeItem(HOME_KEY);
    } catch {
      // 解除はベストエフォート。状態だけは確実にクリアする。
    }
    setHome(null);
    setHomeNote("自宅の登録を解除しました。");
  };

  const result = state.status === "success" ? state.result : null;

  const mapStart: LngLat | null = useMemo(() => {
    if (result) return result.start;
    return [lng, lat];
  }, [result, lat, lng]);

  const candidates = result?.candidates ?? [];

  const onSubmit = () => {
    // ランニング用途のため徒歩(walk)固定。
    void run({
      lat,
      lng,
      targetMeters: Math.round(targetKm * 1000),
      profile: "walk",
      avoidSignals,
      avoidNarrowRoads,
    });
  };

  const getPosition = (options: PositionOptions) =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });

  // IP ベースの概算現在地（サーバー経由）。ブラウザ測位が使えない環境の代替。
  const locateByIp = async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/geo-ip");
      const j = await res.json();
      if (!res.ok) {
        setGeoError(j?.error ?? "IP からの現在地取得に失敗しました。");
        return false;
      }
      setLat(Number(Number(j.lat).toFixed(6)));
      setLng(Number(Number(j.lng).toFixed(6)));
      setGeoNote(
        `概算現在地(IP${j.city ? ` / ${j.city}` : ""})を使用しました。精度は都市レベルです。地図クリックで微調整できます。`
      );
      return true;
    } catch (err) {
      setGeoError(
        err instanceof Error
          ? `IP からの現在地取得に失敗: ${err.message}`
          : "IP からの現在地取得に失敗しました。"
      );
      return false;
    }
  };

  const requestCurrentLocation = async () => {
    setLocating(true);
    setGeoError(null);
    setGeoNote(null);
    try {
      // まずブラウザ測位を 1 回だけ試す（始点は道路へスナップするため低精度で十分）。
      if ("geolocation" in navigator) {
        try {
          const pos = await getPosition({
            enableHighAccuracy: false,
            timeout: 7000,
            maximumAge: 600_000,
          });
          setLat(Number(pos.coords.latitude.toFixed(6)));
          setLng(Number(pos.coords.longitude.toFixed(6)));
          return;
        } catch (err) {
          const e = err as GeolocationPositionError;
          // 許可拒否はユーザー操作が必要なので IP に進まず明示する。
          if (e.code === e.PERMISSION_DENIED) {
            setGeoError(
              "位置情報の利用が拒否されました。ブラウザ/OS の許可設定を確認してください。"
            );
            return;
          }
          // 取得不能・タイムアウト（macOS の kCLErrorLocationUnknown 等）→ IP 概算へ。
        }
      }
      await locateByIp();
    } finally {
      setLocating(false);
    }
  };

  // モバイルで閉じている時だけシート内容を不活性化（フォーカス/SR から除外）。md は常時操作可。
  // peek（つまみのみ）のときだけ内容を不活性化。mid/full は操作可。
  const sheetCollapsed = snap === "peek" && !isDesktop;

  return (
    <div className="relative flex h-[calc(100dvh-var(--nav-h))] w-full flex-col overflow-hidden md:flex-row">
      <main className="relative order-1 min-h-0 flex-1 md:order-2">
        <MapView
          start={mapStart}
          candidates={candidates}
          selectedId={selectedId}
          view={view}
          theme={theme}
          basemap={basemap}
          onToggleBasemap={() => setBasemap((b) => (b === "satellite" ? "map" : "satellite"))}
          onPick={(pLng, pLat) => {
            setLng(Number(pLng.toFixed(6)));
            setLat(Number(pLat.toFixed(6)));
          }}
          onSelectRoute={(id) => {
            // 選択中のループを再タップ → 比較へ戻る。
            if (view === "focus" && id === selectedId) {
              setView("compare");
            } else {
              setSelectedId(id);
              setView("focus");
            }
          }}
        />
      </main>

      <aside
        ref={sheetRef}
        data-snap={snap}
        className="absolute inset-x-0 bottom-0 z-10 order-2 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-border bg-surface shadow-[0_-8px_30px_rgb(0_0_0/0.25)] transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none md:static md:order-1 md:max-h-none md:w-[380px] md:rounded-none md:border-t-0 md:border-r md:shadow-none md:transform-none"
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          ...(sheetTranslate !== null
            ? {
                transform: `translateY(${sheetTranslate}px)`,
                transition: dragY !== null ? "none" : undefined,
              }
            : {}),
        }}
      >
        {/* モバイル用ハンドル：タップで開閉、掴んで上下にドラッグでも開閉。 */}
        <button
          ref={handleRef}
          type="button"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerEnd}
          onPointerCancel={onHandlePointerEnd}
          onClick={onHandleClick}
          aria-expanded={snap !== "peek"}
          aria-controls="rt-controls"
          aria-label={snap === "peek" ? "設定パネルを開く" : "設定パネルを閉じる"}
          className="flex min-h-9 shrink-0 touch-none items-center justify-center px-4 md:hidden"
        >
          {/* つまみのみ。開閉ラベルはボトムシートの慣習として省略（名前は aria-label で担保）。 */}
          <span className="h-1.5 w-10 rounded-full bg-surface-3" aria-hidden="true" />
        </button>

        <div
          id="rt-controls"
          inert={sheetCollapsed}
          className="flex max-h-[76dvh] flex-col gap-4 overflow-y-auto overscroll-contain p-4 md:max-h-none"
        >
          <header>
            <h1 className="font-display text-lg font-extrabold tracking-tight text-fg">
              目標距離から、最適なループを導く
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              等時線ポリゴン法でコース候補を張り、パレート最適化で最良の一周を選抜。
            </p>
            <p className="mt-2 text-[10px] text-faint">Lewis &amp; Corcoran 2024</p>
          </header>

          <section className="flex flex-col gap-3">
            <div>
              <span className="text-xs font-semibold text-muted">プリセット</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {home && (
                  <button
                    type="button"
                    onClick={useHome}
                    className="rounded-full border border-success/40 bg-success-soft px-2.5 py-1 text-xs font-semibold text-success-fg hover:border-success"
                  >
                    🏠 自宅
                  </button>
                )}
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setLat(p.lat);
                      setLng(p.lng);
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => void requestCurrentLocation()}
                disabled={locating}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent-soft-border bg-accent-soft px-2 py-1.5 text-sm font-semibold text-accent-soft-fg transition-colors hover:brightness-105 disabled:opacity-50"
              >
                {locating ? "現在地を取得中…" : "📍 現在地を始点にする"}
              </button>
              {geoNote && <p className="mt-1 text-[11px] text-accent-soft-fg">{geoNote}</p>}
              {geoError && <p className="mt-1 text-[11px] text-danger-fg">{geoError}</p>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={saveHome}
                  className="min-h-9 flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-fg"
                >
                  🏠 この地点を自宅に登録
                </button>
                {home && (
                  <button
                    type="button"
                    onClick={clearHome}
                    className="inline-flex min-h-6 items-center px-1 text-[11px] text-faint underline hover:text-fg"
                  >
                    解除
                  </button>
                )}
              </div>
              {homeNote && (
                <p className="mt-1 text-[11px] text-success-fg" aria-live="polite">
                  {homeNote}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col text-xs font-semibold text-muted">
                緯度 (lat)
                <input
                  type="number"
                  step="0.0001"
                  value={lat}
                  onChange={(e) => setLat(Number(e.target.value))}
                  className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-base text-fg sm:text-sm"
                />
              </label>
              <label className="flex flex-col text-xs font-semibold text-muted">
                経度 (lng)
                <input
                  type="number"
                  step="0.0001"
                  value={lng}
                  onChange={(e) => setLng(Number(e.target.value))}
                  className="mt-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-base text-fg sm:text-sm"
                />
              </label>
            </div>
            <p className="-mt-1 text-[11px] text-faint">
              地図をクリックして始点を指定することもできます。
            </p>

            <label className="flex flex-col text-xs font-semibold text-muted">
              目標距離:{" "}
              <span className="font-semibold text-accent-soft-fg">{targetKm.toFixed(1)} km</span>
              <input
                type="range"
                min={0.5}
                max={42}
                step={0.5}
                value={targetKm}
                onChange={(e) => setTargetKm(Number(e.target.value))}
                className="mt-1"
              />
            </label>
            {targetKm >= 25 && (
              <p className="-mt-1 text-[11px] text-faint">
                長距離は計算に時間がかかります（最大 40 秒ほど）。
              </p>
            )}

            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={avoidSignals}
                onChange={(e) => setAvoidSignals(e.target.checked)}
                className="size-4"
              />
              信号・曲がりを減らす（信号を避ける経路を優先）
            </label>

            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={avoidNarrowRoads}
                onChange={(e) => setAvoidNarrowRoads(e.target.checked)}
                className="size-4"
              />
              細い道を避ける（路地・遊歩道より広い通りを優先）
            </label>

            <button
              type="button"
              onClick={onSubmit}
              disabled={state.status === "loading"}
              className="min-h-11 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg shadow-sm transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {state.status === "loading" ? "計算中…（数秒）" : "コースを計算"}
            </button>

            <p className="text-[10px] text-faint">
              地図: ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-fg"
              >
                OpenStreetMap
              </a>{" "}
              · ©{" "}
              <a
                href="https://carto.com/attributions"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-fg"
              >
                CARTO
              </a>
            </p>
          </section>

          {state.status === "error" && (
            <p className="rounded-lg border border-danger/30 bg-danger-soft p-2 text-xs text-danger-fg">
              {state.message}
            </p>
          )}

          {result && (
            <section className="flex flex-col gap-2">
              <div className="text-[11px] text-faint">
                候補 {result.candidates.length} 件 / ノード {result.stats.graphNodes}・ エッジ{" "}
                {result.stats.graphEdges} / 計算 {result.stats.computeMs}ms （Overpass{" "}
                {result.stats.overpassMs}ms）
              </div>

              {/* 比較（全候補を色分け）↔ フォーカス（選択した1本に集中）の切替。 */}
              <div
                className="flex gap-1 rounded-lg bg-surface-2 p-0.5 text-xs font-medium"
                role="group"
                aria-label="候補の表示モード"
              >
                <button
                  type="button"
                  onClick={() => setView("compare")}
                  aria-pressed={view === "compare"}
                  className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
                    view === "compare" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  比較（全{candidates.length}本）
                </button>
                <button
                  type="button"
                  onClick={() => setView("focus")}
                  aria-pressed={view === "focus"}
                  className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
                    view === "focus" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
                  }`}
                >
                  選択中の1本
                </button>
              </div>

              <ul className="flex flex-col gap-1.5">
                {candidates.map((c, i) => {
                  // 比較中はどのカードも選択表示にしない（フォーカス中のみ強調）。
                  const isSel = view === "focus" && c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          // フォーカス中に選択中カードを再タップ → 比較へ戻る。
                          if (view === "focus" && c.id === selectedId) {
                            setView("compare");
                          } else {
                            setSelectedId(c.id);
                            setView("focus");
                          }
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          isSel
                            ? "border-accent bg-accent-soft"
                            : "border-border hover:bg-surface-2"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 font-semibold text-fg">
                            {/* 地図上のルート色と対応するスウォッチ。 */}
                            <span
                              aria-hidden="true"
                              className="inline-block size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: routeColor(theme, i) }}
                            />
                            #{i + 1}
                            {c.id === result.recommendedId && (
                              <span className="ml-1 rounded bg-success-soft px-1 text-[10px] text-success-fg">
                                推奨
                              </span>
                            )}
                          </span>
                          <span className="font-medium text-fg tabular-nums">
                            {(c.lengthMeters / 1000).toFixed(2)} km
                          </span>
                        </div>
                        <div className="mt-0.5 flex justify-between text-[11px] text-muted tabular-nums">
                          <span>誤差 ±{(c.lengthError / 1000).toFixed(2)}km</span>
                          <span>重複 {c.overlapPercent}%</span>
                          <span
                            className={c.onParetoFront ? "text-accent-soft-fg" : "text-faint"}
                            title={`手法: ${c.source}`}
                          >
                            {c.onParetoFront ? "フロント" : "別方向"}
                          </span>
                        </div>
                        <div className="mt-0.5 flex gap-3 text-[11px] text-faint tabular-nums">
                          <span>曲がり {c.turnCount}回</span>
                          {c.signalCount !== null && <span>信号 {c.signalCount}</span>}
                          {c.narrowCount !== null && <span>細道 {c.narrowCount}本</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {(() => {
                // 書き出しは「1本を選択中（フォーカス）」のときだけ有効。
                // レイアウトは固定し、要素の有効/無効だけ切り替える（選択ごとに文章が増減しないように）。
                const focused =
                  view === "focus" ? (candidates.find((c) => c.id === selectedId) ?? null) : null;
                const pickHint = "ルートを1つ選択してください";
                return (
                  <>
                    <button
                      type="button"
                      disabled={!focused}
                      title={focused ? undefined : pickHint}
                      onClick={() => {
                        if (focused) {
                          void shareGpx(
                            focused.path,
                            `round-trip-${(focused.lengthMeters / 1000).toFixed(1)}km`
                          );
                        }
                      }}
                      className="min-h-11 rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-center text-sm font-semibold text-success-fg transition-colors hover:border-success disabled:border-border disabled:bg-surface-2 disabled:text-faint disabled:opacity-60 disabled:hover:border-border"
                    >
                      GPX をスマホに送る / 保存
                    </button>
                    {focused ? (
                      <a
                        href={googleMapsDirUrl(result.start, focused.path)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-border px-3 py-1.5 text-center text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                      >
                        Google マップで開く（近似・参考）
                      </a>
                    ) : (
                      <span
                        aria-disabled="true"
                        title={pickHint}
                        className="rounded-lg border border-border px-3 py-1.5 text-center text-xs text-faint opacity-60"
                      >
                        Google マップで開く（近似・参考）
                      </span>
                    )}
                    {/* 文言は選択状態によらず固定（チラつき防止）。 */}
                    <p className="text-[10px] text-faint">
                      GPX をスマホの共有シートから <b>OsmAnd / Komoot / Garmin Connect</b>{" "}
                      に渡すと音声＋ライン表示で正確にナビできます（Google
                      マップは経由地を再探索する近似）。
                    </p>
                  </>
                );
              })()}
              <p className="text-[10px] text-faint">{result.attribution}</p>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
};
