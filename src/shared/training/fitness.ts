import { isoToYmdLocal, parseYmd } from "@/shared/training/date";
import { observedMaxHr } from "@/shared/training/heart-rate";
import { estimateCurrentVdot } from "@/shared/training/paces";
import type { Activity, Fitness } from "@/shared/types/training";

/** 走力推定のデフォルト（履歴が無い/少ない場合の控えめな初期値）。 */
const FALLBACK: Fitness = {
  weeklyKm: 10,
  longestKm: 5,
  easyPaceSecPerKm: 360, // 6:00/km
  currentVdot: null,
  maxHrObserved: null,
};

/**
 * 直近のラン履歴から走力を推定する。
 * - weeklyKm: 直近 4 週の平均週間距離
 * - longestKm: 直近 8 週の最長単走
 * - easyPaceSecPerKm: 直近のランの距離加重平均ペースをやや緩めた値
 *
 * 履歴が空なら控えめな既定値を返す（推測で過大評価しない）。
 */
export function estimateFitness(activities: Activity[], nowMs: number): Fitness {
  const runs = activities.filter((a) => a.distanceKm > 0 && a.durationSec > 0);
  if (runs.length === 0) return { ...FALLBACK };

  const within = (days: number) =>
    runs.filter((a) => nowMs - parseYmd(isoToYmdLocal(a.date)) <= days * 86_400_000);

  const last4w = within(28);
  const last8w = within(56);

  const km4w = last4w.reduce((s, a) => s + a.distanceKm, 0);
  const weeklyKm = last4w.length > 0 ? km4w / 4 : FALLBACK.weeklyKm;

  const longestKm =
    last8w.length > 0 ? Math.max(...last8w.map((a) => a.distanceKm)) : FALLBACK.longestKm;

  // 距離加重の平均ペース（実測タイムから算出）。イージーは実測よりやや緩める。
  const paceSource = last8w.length > 0 ? last8w : runs;
  const totalKm = paceSource.reduce((s, a) => s + a.distanceKm, 0);
  const totalSec = paceSource.reduce((s, a) => s + a.durationSec, 0);
  const avgPace = totalKm > 0 ? totalSec / totalKm : FALLBACK.easyPaceSecPerKm;
  // イージーペース = 平均の +8%（楽に走れるペース）。
  const easyPaceSecPerKm = Math.round(avgPace * 1.08);

  const maxHrObserved = observedMaxHr(runs);

  return {
    weeklyKm: Math.round(weeklyKm * 10) / 10,
    longestKm: Math.round(longestKm * 10) / 10,
    easyPaceSecPerKm,
    currentVdot: estimateCurrentVdot(runs, nowMs, maxHrObserved),
    maxHrObserved,
  };
}
