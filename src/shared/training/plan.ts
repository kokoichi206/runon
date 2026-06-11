import { addDays, diffDays, weekday } from "@/shared/training/date";
import { bpmRange, zoneForWorkout } from "@/shared/training/heart-rate";
import { trainingPaces, vdotFromPerformance } from "@/shared/training/paces";
import type {
  PlanInput,
  PlannedWorkout,
  RecentLoad,
  TrainingPhase,
  WeeklyAvailability,
  WorkoutType,
} from "@/shared/types/training";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * 実測負荷(ACWR)に応じた開始ボリュームの乗数。
 * 急増(>1.5)や急減後(<0.8)は序盤を保守的にする。負荷データが無ければ 1.0（従来挙動と一致）。
 * ピーク距離やテーパーには影響させず、起点の安全側調整のみに限定する。
 */
const startVolumeFactor = (recentLoad: RecentLoad | null | undefined): number => {
  if (recentLoad == null) return 1.0;
  const r = recentLoad.ratio;
  if (r > 1.5) return 0.8;
  if (r > 1.3) return 0.9;
  if (r < 0.8) return 0.9;
  return 1.0;
};

/**
 * レース距離からピーク時のロング走距離(km)を決める（区間線形補間＋上限）。
 */
const peakLongFromRace = (raceKm: number): number => {
  const anchors: [number, number][] = [
    [5, 10],
    [10, 16],
    [21.1, 20],
    [42.2, 32],
  ];
  if (raceKm <= anchors[0]![0]) return raceKm * 2;
  if (raceKm >= anchors[anchors.length - 1]![0]) {
    return Math.min(35, 32 + (raceKm - 42.2) * 0.2);
  }
  for (let i = 0; i + 1 < anchors.length; i++) {
    const [x0, y0] = anchors[i]!;
    const [x1, y1] = anchors[i + 1]!;
    if (raceKm >= x0 && raceKm <= x1) {
      const f = (raceKm - x0) / (x1 - x0);
      return y0 + (y1 - y0) * f;
    }
  }
  return raceKm;
};

const TAPER_FACTORS = [0.7, 0.55, 0.4];

/**
 * 配列から k 要素の組合せを全列挙（要素数が小さい前提＝曜日は最大7）。
 */
const combinations = <T>(arr: T[], k: number): T[][] => {
  if (k <= 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...rest] = arr;
  return [...combinations(rest, k - 1).map((c) => [head!, ...c]), ...combinations(rest, k)];
};

/**
 * 選んだ曜日集合の最小「円環ギャップ」（週内の隣接間隔の最小値）。大きいほど均等に分散。
 */
const minCircularGap = (weekdays: number[]): number => {
  if (weekdays.length <= 1) return 7;
  const s = [...weekdays].sort((a, b) => a - b);
  let min = Infinity;
  for (let i = 0; i < s.length; i++) {
    const next = i + 1 < s.length ? s[i + 1]! : s[0]! + 7;
    min = Math.min(min, next - s[i]!);
  }
  return min;
};

/**
 * 可能日 available から k 日を選ぶ。ロング走日 longDay は必ず含め、
 * 週内で最も均等に分散する集合を選ぶ（最小ギャップ最大化、同点は確保時間合計が多い方）。
 */
const selectRunWeekdays = (
  available: number[],
  longDay: number | null,
  k: number,
  availability: WeeklyAvailability
): Set<number> => {
  if (available.length === 0 || k <= 0) return new Set();
  if (k >= available.length) return new Set(available);
  const must = longDay !== null && available.includes(longDay) ? longDay : available[0]!;
  const rest = available.filter((d) => d !== must);
  const minutesOf = (wd: number) => availability[wd]?.maxMinutes ?? 0;

  let best: number[] = [must, ...rest.slice(0, k - 1)];
  let bestGap = -Infinity;
  let bestTime = -Infinity;
  for (const combo of combinations(rest, k - 1)) {
    const sel = [must, ...combo];
    const gap = minCircularGap(sel);
    const time = sel.reduce((s, wd) => s + minutesOf(wd), 0);
    if (gap > bestGap || (gap === bestGap && time > bestTime)) {
      best = sel;
      bestGap = gap;
      bestTime = time;
    }
  }
  return new Set(best);
};

const workoutTitle = (type: WorkoutType): string => {
  switch (type) {
    case "rest":
      return "休養";
    case "easy":
      return "イージーラン";
    case "long":
      return "ロング走";
    case "tempo":
      return "テンポ走";
    case "interval":
      return "インターバル";
    case "race":
      return "レース";
  }
};

/**
 * 目標レースまでのトレーニング計画を生成する純粋関数。
 *
 * 設計（ヒューリスティック・医学的助言ではない）:
 * - 期分け: base → build → peak → taper（最後の 1〜3 週）。
 * - ロング走を現在の最長走からレース距離由来のピークへ漸増、テーパーで減量。
 * - 練習曜日のうち最も時間が取れる曜日をロング走に、次点を quality(テンポ)に割当。
 * - 距離は平均ペースで所要時間へ換算し、その曜日の確保時間 maxMinutes を上限にキャップ。
 * - スキップ日と非練習日は休養。レース週は脚を残すため軽め＋前日休養。
 */
export const generatePlan = (input: PlanInput): PlannedWorkout[] => {
  const { startDate, race, fitness, availability } = input;
  const skipped = new Set(input.skippedDates ?? []);

  const totalDays = diffDays(startDate, race.date);
  if (totalDays < 0) return [];

  const lastWeek = Math.floor(totalDays / 7);
  const totalWeeks = lastWeek + 1;
  const taperWeeks =
    totalWeeks >= 4 ? clamp(Math.round(totalWeeks * 0.15), 1, 3) : totalWeeks >= 2 ? 1 : 0;
  const taperStartWeek = totalWeeks - taperWeeks;
  const nonTaper = Math.max(0, taperStartWeek);
  const baseEnd = Math.floor(nonTaper * 0.4);
  const buildEnd = Math.floor(nonTaper * 0.8);

  const phaseOf = (w: number): TrainingPhase => {
    if (w >= taperStartWeek) return "taper";
    if (w < baseEnd) return "base";
    if (w < buildEnd) return "build";
    return "peak";
  };

  // ピークのロング走: レース距離由来の目標と、現走力(最長走)からの安全上限の小さい方。
  // 現状からの無理な急増（故障リスク）を避けるためのガード。
  const raceLong = peakLongFromRace(race.distanceKm);
  // 起点だけ ACWR で安全側に調整（peakLong/漸増/テーパーは不変＝距離アンカー温存）。
  const startLong = clamp(
    (fitness.longestKm || 3) * startVolumeFactor(fitness.recentLoad),
    3,
    raceLong
  );
  const fitnessCapLong = (fitness.longestKm || 3) * 2 + 2;
  const peakLong = clamp(Math.min(raceLong, fitnessCapLong), startLong + 1, raceLong);

  const longKmForWeek = (w: number): number => {
    if (w < taperStartWeek) {
      if (nonTaper <= 1) return peakLong;
      const f = w / (nonTaper - 1);
      return startLong + (peakLong - startLong) * f;
    }
    const ti = w - taperStartWeek;
    return peakLong * (TAPER_FACTORS[Math.min(ti, TAPER_FACTORS.length - 1)] ?? 0.4);
  };

  // 練習が可能な曜日（時間が確保できる曜日）。
  const availableWeekdays = [0, 1, 2, 3, 4, 5, 6].filter(
    (wd) => availability[wd]?.isPracticeDay && (availability[wd]?.maxMinutes ?? 0) > 0
  );
  const byTimeDesc = [...availableWeekdays].sort(
    (a, b) => availability[b]!.maxMinutes - availability[a]!.maxMinutes || b - a
  );
  const longRunWeekday = byTimeDesc[0] ?? null;

  // 週あたりの練習回数だけを可能日から選ぶ（ロング走日は必須、残りは分散優先）。
  const requestedRuns = input.runsPerWeek ?? availableWeekdays.length;
  const runDays = clamp(
    requestedRuns,
    availableWeekdays.length > 0 ? 1 : 0,
    availableWeekdays.length
  );
  const selectedWeekdays = selectRunWeekdays(
    availableWeekdays,
    longRunWeekday,
    runDays,
    availability
  );
  const qualityWeekday =
    [...selectedWeekdays]
      .filter((wd) => wd !== longRunWeekday)
      .sort((a, b) => availability[b]!.maxMinutes - availability[a]!.maxMinutes)[0] ?? null;

  // ペース: 目標タイムがあれば VDOT ゾーンから設計。無ければ現走力(イージーペース)から近似。
  let easyPace: number;
  let tempoPace: number;
  let racePace: number;
  let longPace: number;
  if (race.goalTimeSec && race.goalTimeSec > 0) {
    const goalVdot = vdotFromPerformance(race.distanceKm, race.goalTimeSec);
    const z = trainingPaces(goalVdot);
    easyPace = z.easy;
    tempoPace = z.threshold;
    racePace = Math.round(race.goalTimeSec / race.distanceKm); // 目標レースペース
    // フルのロングはマラソンペース寄り、それ以外はイージー。
    longPace = race.distanceKm >= 30 ? z.marathon : z.easy;
  } else {
    easyPace = fitness.easyPaceSecPerKm;
    tempoPace = Math.round(easyPace * 0.88);
    racePace = Math.round(easyPace * 0.85);
    longPace = easyPace;
  }

  const out: PlannedWorkout[] = [];

  for (let d = 0; d <= totalDays; d++) {
    const date = addDays(startDate, d);
    const w = Math.floor(d / 7);
    const wd = weekday(date);
    const phase = phaseOf(w);

    let type: WorkoutType = "rest";
    let distanceKm = 0;
    let pace = easyPace;
    let note: string | undefined;

    if (date === race.date) {
      type = "race";
      distanceKm = race.distanceKm;
      pace = racePace;
    } else if (skipped.has(date)) {
      type = "rest";
      note = "スキップ（お休み）";
    } else if (!selectedWeekdays.has(wd)) {
      type = "rest";
    } else if (w === lastWeek) {
      // レース週: 脚を残す。前日は休養、それ以外は軽いイージー。
      const daysToRace = diffDays(date, race.date);
      if (daysToRace <= 1) {
        type = "rest";
        note = "レース前日（休養）";
      } else {
        type = "easy";
        distanceKm = clamp(0.4 * longKmForWeek(w), 2, 5);
      }
    } else if (wd === longRunWeekday) {
      type = "long";
      distanceKm = longKmForWeek(w);
      pace = longPace;
    } else if (wd === qualityWeekday && (phase === "build" || phase === "peak")) {
      type = "tempo";
      distanceKm = clamp(0.6 * longKmForWeek(w), 3, peakLong * 0.7);
      pace = tempoPace;
    } else {
      type = "easy";
      distanceKm = clamp(0.5 * longKmForWeek(w), 2, peakLong * 0.7);
    }

    // 距離→推定時間。確保時間の上限でキャップ。
    let estMinutes = (distanceKm * pace) / 60;
    let cappedByTime = false;
    if (type !== "rest" && type !== "race") {
      const maxMin = availability[wd]?.maxMinutes ?? 0;
      if (maxMin > 0 && estMinutes > maxMin) {
        distanceKm = (maxMin * 60) / pace;
        estMinutes = maxMin;
        cappedByTime = true;
      }
    }

    const hrZone = type === "rest" ? undefined : zoneForWorkout(type);
    out.push({
      date,
      weekIndex: w,
      phase: type === "race" ? "race" : phase,
      type,
      distanceKm: round1(distanceKm),
      estMinutes: Math.round(estMinutes),
      paceSecPerKm: type === "rest" ? undefined : Math.round(pace),
      hrZone,
      hrBpmRange:
        hrZone && fitness.maxHrObserved ? bpmRange(fitness.maxHrObserved, hrZone) : undefined,
      title: workoutTitle(type),
      note,
      cappedByTime: cappedByTime || undefined,
    });
  }

  markKeyWorkouts(out);
  return out;
};

// ワークアウト種別の優先度（週の「ポイント練習」を選ぶ基準。高いほど重要）。
const KEY_PRIORITY: Record<WorkoutType, number> = {
  race: 5,
  interval: 4,
  tempo: 3,
  long: 2,
  easy: 1,
  rest: 0,
};

/**
 * 各週に「ポイント練習」を1つだけ立てる（最重要セッション）。
 */
const markKeyWorkouts = (plan: PlannedWorkout[]): void => {
  const bestByWeek = new Map<number, PlannedWorkout>();
  for (const w of plan) {
    if (w.type === "rest") continue;
    const cur = bestByWeek.get(w.weekIndex);
    const better =
      !cur ||
      KEY_PRIORITY[w.type] > KEY_PRIORITY[cur.type] ||
      (KEY_PRIORITY[w.type] === KEY_PRIORITY[cur.type] && w.distanceKm > cur.distanceKm);
    if (better) bestByWeek.set(w.weekIndex, w);
  }
  for (const w of bestByWeek.values()) {
    w.isKey = true;
    if (w.type !== "race") {
      w.note = w.note ? `${w.note} / 今週のポイント` : "今週のポイント";
    }
  }
};

/**
 * 週ごとの集計（UI 表示用）。
 */
export interface WeekSummary {
  weekIndex: number;
  phase: TrainingPhase;
  startDate: string;
  totalKm: number;
  totalMinutes: number;
  runDays: number;
}

export const summarizeByWeek = (plan: PlannedWorkout[]): WeekSummary[] => {
  const map = new Map<number, WeekSummary>();
  for (const w of plan) {
    let s = map.get(w.weekIndex);
    if (!s) {
      s = {
        weekIndex: w.weekIndex,
        phase: w.phase,
        startDate: w.date,
        totalKm: 0,
        totalMinutes: 0,
        runDays: 0,
      };
      map.set(w.weekIndex, s);
    }
    if (w.phase !== "race" || w.type === "race") {
      // 週の代表フェーズは最初の非 rest を優先しつつ race を尊重。
      if (w.type === "race") s.phase = "race";
    }
    s.totalKm += w.distanceKm;
    s.totalMinutes += w.estMinutes;
    if (w.type !== "rest") s.runDays += 1;
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      totalKm: round1(s.totalKm),
    }))
    .sort((a, b) => a.weekIndex - b.weekIndex);
};
