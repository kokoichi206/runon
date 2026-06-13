import { addDays, diffDays, weekday } from "@/shared/training/date";
import { bpmRange, zoneForWorkout } from "@/shared/training/heart-rate";
import {
  predictTimeSec,
  trainingPaces,
  vdotFromPerformance,
  type TrainingPaces,
} from "@/shared/training/paces";
import type {
  BlockPlanInput,
  PlanInput,
  PlannedWorkout,
  RecentLoad,
  TrainingPhase,
  WeeklyAvailability,
  WorkoutSegment,
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
    case "repetition":
      return "レペティション";
    case "timeTrial":
      return "3000m TT";
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
  timeTrial: 5,
  interval: 4,
  repetition: 4,
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

// ============================================================================
// 5km 強化ブロック（目標レース無し）
//
// 設計（Daniels' Running Formula の 5km–10km の組み立てに寄せる・医学的助言ではない）:
// - 終端は週数で固定。4 週マイクロサイクルを繰り返す: T(クルーズ) → I → R → 3000m TT。
// - 質練習は WU/CD を挟み、本数は週間距離からの量上限で決める（T≈10%/I≈8%/R≈5%）。
// - 各週ロング走 1 本（E ペース、TT 週は軽め）、残りはイージー。
// - ペースは現在 VDOT から E/M/T/I/R を算出。VDOT 未取得なら強度走は保留し、
//   まず 3000m TT で計測する（当てずっぽうの強度ペースを置かない）。
// ============================================================================

const WARMUP_KM = 1.5;
const COOLDOWN_KM = 1.5;

// つなぎ(リカバリー)の推定ペース。jog はイージー相当、walk はさらに緩い。
const recoverPace = (easyPace: number, kind: "jog" | "walk"): number =>
  kind === "jog" ? easyPace : Math.round(easyPace * 1.5);

/**
 * セッション（segments）の合計距離(km)と推定時間(分)。
 * reps はつなぎを各本に付く前提で合算する（時間見積りはやや上振れ側で安全）。
 */
const sessionTotals = (
  segments: WorkoutSegment[],
  easyPace: number
): {
  distanceKm: number;
  estMinutes: number;
} => {
  let dist = 0;
  let sec = 0;
  for (const s of segments) {
    if (s.kind === "run") {
      dist += s.distanceKm;
      sec += s.distanceKm * s.paceSecPerKm;
    } else {
      const recSecPerKm = recoverPace(easyPace, s.recoverKind);
      dist += (s.reps * (s.repMeters + s.recoverMeters)) / 1000;
      sec +=
        s.reps *
        ((s.repMeters / 1000) * s.paceSecPerKm + (s.recoverMeters / 1000) * recSecPerKm);
    }
  }
  return {
    distanceKm: dist,
    estMinutes: sec / 60,
  };
};

interface RepsSpec {
  type: WorkoutType;
  role: "threshold" | "interval" | "repetition";
  repMeters: number;
  recoverMeters: number;
  recoverKind: "jog" | "walk";
  pace: number;
  baseReps: number;
  minReps: number;
}

/**
 * 週サイクルに応じた反復セッションの仕様（Daniels の量上限を週間距離から算出）。
 * cycleWeek 0=T(クルーズ), 1=I, 2=R。
 */
const repsSpecForCycle = (
  cycleWeek: number,
  paces: TrainingPaces,
  weeklyKm: number
): RepsSpec => {
  if (cycleWeek === 0) {
    return {
      type: "tempo",
      role: "threshold",
      repMeters: 1000,
      recoverMeters: 200,
      recoverKind: "jog",
      pace: paces.threshold,
      baseReps: clamp(Math.round(weeklyKm * 0.1), 3, 6), // T ≤ 週間の約10%
      minReps: 3,
    };
  }
  if (cycleWeek === 1) {
    return {
      type: "interval",
      role: "interval",
      repMeters: 1000,
      recoverMeters: 400,
      recoverKind: "jog",
      pace: paces.interval,
      baseReps: clamp(Math.round(weeklyKm * 0.08), 3, 5), // I ≤ 週間の約8%
      minReps: 3,
    };
  }
  return {
    type: "repetition",
    role: "repetition",
    repMeters: 200,
    recoverMeters: 200,
    recoverKind: "jog",
    pace: paces.repetition,
    baseReps: clamp(Math.round((weeklyKm * 0.05 * 1000) / 200), 6, 10), // R ≤ 週間の約5%
    minReps: 4,
  };
};

/**
 * 反復セッションを WU/CD で挟んで組む。確保時間に収まるよう本数を減らす。
 */
const buildRepsSession = (
  spec: RepsSpec,
  easyPace: number,
  maxMinutes: number
): {
  segments: WorkoutSegment[];
  cappedByTime: boolean;
} => {
  const make = (reps: number): WorkoutSegment[] => [
    {
      kind: "run",
      role: "warmup",
      distanceKm: WARMUP_KM,
      paceSecPerKm: easyPace,
    },
    {
      kind: "reps",
      role: spec.role,
      reps,
      repMeters: spec.repMeters,
      paceSecPerKm: spec.pace,
      recoverMeters: spec.recoverMeters,
      recoverKind: spec.recoverKind,
    },
    {
      kind: "run",
      role: "cooldown",
      distanceKm: COOLDOWN_KM,
      paceSecPerKm: easyPace,
    },
  ];
  let reps = spec.baseReps;
  while (reps > spec.minReps && sessionTotals(make(reps), easyPace).estMinutes > maxMinutes) {
    reps -= 1;
  }
  const cappedByTime =
    reps < spec.baseReps || sessionTotals(make(reps), easyPace).estMinutes > maxMinutes;
  return {
    segments: make(reps),
    cappedByTime,
  };
};

/**
 * 3000m TT セッション。WU + 3000m + CD。
 * 目標ペースは現在 VDOT からの 3000m 予測ペース。VDOT 無しなら全力（ペース非表示）。
 */
const buildTimeTrial = (
  vdot: number | null,
  easyPace: number
): {
  segments: WorkoutSegment[];
  distanceKm: number;
  estMinutes: number;
  pace: number | undefined;
  note: string;
} => {
  const ttPace = vdot !== null ? Math.round(predictTimeSec(vdot, 3) / 3) : null;
  // 時間見積りのみに使う努力ペース（表示する目標ペースではない）。VDOT 無しは控えめに見積もる。
  const effortPace = ttPace ?? Math.round(easyPace * 0.85);
  const wu = 2.0;
  const cd = 1.5;
  const distanceKm = wu + 3 + cd;
  const estMinutes = (wu * easyPace + 3 * effortPace + cd * easyPace) / 60;
  const segments: WorkoutSegment[] = [
    {
      kind: "run",
      role: "warmup",
      distanceKm: wu,
      paceSecPerKm: easyPace,
    },
    ...(ttPace !== null
      ? [
          {
            kind: "run",
            role: "steady",
            distanceKm: 3,
            paceSecPerKm: ttPace,
          } satisfies WorkoutSegment,
        ]
      : []),
    {
      kind: "run",
      role: "cooldown",
      distanceKm: cd,
      paceSecPerKm: easyPace,
    },
  ];
  return {
    segments,
    distanceKm,
    estMinutes,
    pace: ttPace ?? undefined,
    note: ttPace !== null ? "3000m を目標ペースで（VDOT 計測）" : "3000m 全力（初回ベンチマーク・VDOT 計測）",
  };
};

interface QualityDayFields {
  type: WorkoutType;
  segments: WorkoutSegment[];
  distanceKm: number;
  estMinutes: number;
  pace: number;
  cappedByTime: boolean;
}

/**
 * RepsSpec から 1 日分のフィールド（種別・segments・距離・時間・ペース）を組む。
 */
const repsDayFields = (spec: RepsSpec, easyPace: number, maxMinutes: number): QualityDayFields => {
  const built = buildRepsSession(spec, easyPace, maxMinutes);
  const totals = sessionTotals(built.segments, easyPace);
  return {
    type: spec.type,
    segments: built.segments,
    distanceKm: totals.distanceKm,
    estMinutes: totals.estMinutes,
    pace: spec.pace,
    cappedByTime: built.cappedByTime,
  };
};

/**
 * 目標レースを置かない 5km 強化ブロックを生成する純粋関数。
 */
export const generateBlockPlan = (input: BlockPlanInput): PlannedWorkout[] => {
  const { startDate, weeks, targetDistanceKm, fitness, availability } = input;
  if (weeks <= 0) return [];
  const skipped = new Set(input.skippedDates ?? []);
  const totalDays = weeks * 7 - 1;

  const paces = fitness.currentVdot !== null ? trainingPaces(fitness.currentVdot) : null;
  const easyPace = paces ? paces.easy : fitness.easyPaceSecPerKm;

  // ロング/質曜日の割当は race モードと同じ規則を再利用。
  const availableWeekdays = [0, 1, 2, 3, 4, 5, 6].filter(
    (wd) => availability[wd]?.isPracticeDay && (availability[wd]?.maxMinutes ?? 0) > 0
  );
  const byTimeDesc = [...availableWeekdays].sort(
    (a, b) => availability[b]!.maxMinutes - availability[a]!.maxMinutes || b - a
  );
  const longRunWeekday = byTimeDesc[0] ?? null;
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
  // 質練習日: ロング走以外で時間が取れる順。練習日数に応じて主 Q（必ず）と副 Q（余裕がある時）を割り当てる。
  // 1 日しか取れない場合は同じ日で主 Q を回す（副 Q は無し）。
  const qualityCandidates = [...selectedWeekdays]
    .filter((wd) => wd !== longRunWeekday)
    .sort((a, b) => availability[b]!.maxMinutes - availability[a]!.maxMinutes);
  const primaryQualityWeekday = qualityCandidates[0] ?? longRunWeekday;
  const secondaryQualityWeekday = qualityCandidates[1] ?? null;

  // ロング走距離（5k 向けに中庸・概ね一定。現状の最長走を大きく超えない）。
  const longCap = fitness.longestKm > 0 ? fitness.longestKm * 1.1 : targetDistanceKm * 2;
  const baseLong = clamp(Math.min(targetDistanceKm * 2, fitness.weeklyKm * 0.3), 5, longCap);
  const easyKm = clamp(0.5 * baseLong, 3, baseLong * 0.8);

  const out: PlannedWorkout[] = [];

  for (let d = 0; d <= totalDays; d++) {
    const date = addDays(startDate, d);
    const w = Math.floor(d / 7);
    const wd = weekday(date);
    const cycleWeek = w % 4;
    const isTTWeek = cycleWeek === 3;
    const maxMin = availability[wd]?.maxMinutes ?? 0;

    let type: WorkoutType = "rest";
    let distanceKm = 0;
    let pace: number | undefined = easyPace;
    let note: string | undefined;
    let segments: WorkoutSegment[] | undefined;
    let estMinutes = 0;
    let cappedByTime = false;
    let preComputed = false; // segments で距離/時間を確定済みなら連続走キャップを通さない

    if (skipped.has(date)) {
      type = "rest";
      note = "スキップ（お休み）";
    } else if (!selectedWeekdays.has(wd)) {
      type = "rest";
    } else if (wd === primaryQualityWeekday) {
      // 主 Q: TT 週は 3000m TT、その他は rotation（T→I→R）。VDOT 無しは保留。
      if (isTTWeek) {
        const tt = buildTimeTrial(fitness.currentVdot, easyPace);
        type = "timeTrial";
        segments = tt.segments;
        distanceKm = tt.distanceKm;
        estMinutes = tt.estMinutes;
        pace = tt.pace;
        note = tt.note;
        preComputed = true;
      } else if (paces) {
        const f = repsDayFields(repsSpecForCycle(cycleWeek, paces, fitness.weeklyKm), easyPace, maxMin);
        ({ type, segments, distanceKm, estMinutes, pace, cappedByTime } = f);
        preComputed = true;
      } else {
        type = "easy";
        distanceKm = easyKm;
        note = "強度走は VDOT 取得後（まず 3000m TT で計測）";
      }
    } else if (secondaryQualityWeekday !== null && wd === secondaryQualityWeekday && paces) {
      // 副 Q: 主 Q を補完。I/R 週は閾値(T)、T 週は流し付きイージー、TT 週は軽め。
      // いずれも主 Q より KEY_PRIORITY を下げ、週の ★ を主 Q に残す。
      if (isTTWeek) {
        type = "easy";
        distanceKm = easyKm;
        note = "TT に備えて軽め";
      } else if (cycleWeek === 0) {
        type = "easy";
        distanceKm = easyKm;
        note = "流し 6×100m（ウィンドスプリント）";
      } else {
        const spec = repsSpecForCycle(0, paces, fitness.weeklyKm); // 閾値(T)
        spec.baseReps = clamp(Math.round(spec.baseReps * 0.7), spec.minReps, spec.baseReps);
        const f = repsDayFields(spec, easyPace, maxMin);
        ({ type, segments, distanceKm, estMinutes, pace, cappedByTime } = f);
        preComputed = true;
      }
    } else if (wd === longRunWeekday) {
      type = "long";
      distanceKm = isTTWeek ? baseLong * 0.6 : baseLong;
      pace = easyPace;
    } else {
      type = "easy";
      distanceKm = easyKm;
    }

    // 連続走(easy/long)の距離→時間・確保時間キャップ。segments 確定分は対象外。
    if (!preComputed) {
      estMinutes = (distanceKm * (pace ?? easyPace)) / 60;
      if (type !== "rest" && maxMin > 0 && estMinutes > maxMin) {
        distanceKm = (maxMin * 60) / (pace ?? easyPace);
        estMinutes = maxMin;
        cappedByTime = true;
      }
    }

    const hrZone = type === "rest" ? undefined : zoneForWorkout(type);
    out.push({
      date,
      weekIndex: w,
      phase: "build",
      type,
      distanceKm: round1(distanceKm),
      estMinutes: Math.round(estMinutes),
      paceSecPerKm: type === "rest" || pace == null ? undefined : Math.round(pace),
      hrZone,
      hrBpmRange:
        hrZone && fitness.maxHrObserved ? bpmRange(fitness.maxHrObserved, hrZone) : undefined,
      title: workoutTitle(type),
      note,
      cappedByTime: cappedByTime || undefined,
      segments,
    });
  }

  markKeyWorkouts(out);
  return out;
};
