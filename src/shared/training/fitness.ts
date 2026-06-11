import { isoToYmdLocal, parseYmd } from "@/shared/training/date";
import { observedMaxHr } from "@/shared/training/heart-rate";
import { estimateCurrentVdot } from "@/shared/training/paces";
import type { Activity, AthleteProfile, Fitness, RecentLoad } from "@/shared/types/training";

/**
 * 走力推定のデフォルト（履歴が無い/少ない場合の控えめな初期値）。
 */
const FALLBACK: Fitness = {
  weeklyKm: 10,
  longestKm: 5,
  easyPaceSecPerKm: 360, // 6:00/km
  currentVdot: null,
  maxHrObserved: null,
  recentLoad: null,
};

// ACWR を計算してよいとみなすデータ品質の閾値。
const LOAD_MIN_SAMPLES = 6; // 直近28日に relativeEffort を持つ走の最小本数
const LOAD_MIN_COVERAGE = 0.6; // 直近28日のラン中、relativeEffort を持つ割合の下限

/**
 * relativeEffort(実測負荷) から ACWR を計算する。
 * 欠損(非サブスク/心拍なし)を 0 負荷とみなすと比が偽性高値になるため、
 * 「本数・被覆率」の品質ゲートを満たす場合のみ算出し、満たさなければ null を返す。
 */
const computeRecentLoad = (runs: Activity[], nowMs: number): RecentLoad | null => {
  const since = (days: number) =>
    runs.filter((a) => nowMs - parseYmd(isoToYmdLocal(a.date)) <= days * 86_400_000);

  const chronicRuns = since(28);
  if (chronicRuns.length === 0) return null;
  const chronicRE = chronicRuns.map((a) => a.relativeEffort).filter((v): v is number => v != null);
  if (chronicRE.length < LOAD_MIN_SAMPLES) return null;
  if (chronicRE.length / chronicRuns.length < LOAD_MIN_COVERAGE) return null;

  // chronic は28日合計を4で割り、acute(7日合計)と同じ7日スケールに揃える。
  const chronic = chronicRE.reduce((s, v) => s + v, 0) / 4;
  if (chronic <= 0) return null;
  const acute = since(7)
    .map((a) => a.relativeEffort)
    .filter((v): v is number => v != null)
    .reduce((s, v) => s + v, 0);

  return {
    acute: Math.round(acute),
    chronic: Math.round(chronic),
    ratio: Math.round((acute / chronic) * 100) / 100,
  };
};

/**
 * 直近のラン履歴から走力を推定する。
 * - weeklyKm: 直近 4 週の平均週間距離
 * - longestKm: 直近 8 週の最長単走
 * - easyPaceSecPerKm: 直近のランの距離加重平均ペースをやや緩めた値
 *
 * 履歴が空なら控えめな既定値を返す（推測で過大評価しない）。
 *
 * profile（Strava の長期集計）があれば weeklyKm の過小評価を補正する。
 */
export const estimateFitness = (
  activities: Activity[],
  nowMs: number,
  profile?: AthleteProfile
): Fitness => {
  const runs = activities.filter((a) => a.distanceKm > 0 && a.durationSec > 0);
  if (runs.length === 0) return {
    ...FALLBACK,
  };

  const within = (days: number) =>
    runs.filter((a) => nowMs - parseYmd(isoToYmdLocal(a.date)) <= days * 86_400_000);

  const last4w = within(28);
  const last8w = within(56);

  const km4w = last4w.reduce((s, a) => s + a.distanceKm, 0);
  let weeklyKm = last4w.length > 0 ? km4w / 4 : FALLBACK.weeklyKm;
  // Strava 集計の直近4週はサンプル取得漏れの影響を受けないため、過小評価を max で補正。
  const statsWeekly = profile?.recentRunTotals ? profile.recentRunTotals.distanceKm / 4 : null;
  if (statsWeekly !== null) weeklyKm = Math.max(weeklyKm, statsWeekly);

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
    recentLoad: computeRecentLoad(runs, nowMs),
  };
};
