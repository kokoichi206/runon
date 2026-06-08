import { describe, expect, it } from "vitest";

import { addDays, diffDays, weekday } from "@/shared/training/date";
import { estimateFitness } from "@/shared/training/fitness";
import { generatePlan, summarizeByWeek } from "@/shared/training/plan";
import {
  defaultAvailability,
  type Activity,
  type AthleteProfile,
  type Fitness,
  type Race,
  type WeeklyAvailability,
} from "@/shared/types/training";

describe("date utils", () => {
  it("addDays / diffDays / weekday", () => {
    expect(addDays("2026-06-01", 7)).toBe("2026-06-08");
    expect(diffDays("2026-06-01", "2026-06-08")).toBe(7);
    // 2026-06-01 は月曜
    expect(weekday("2026-06-01")).toBe(1);
    expect(weekday("2026-06-06")).toBe(6); // 土
  });
});

describe("estimateFitness", () => {
  const now = new Date("2026-05-28T00:00:00Z").getTime();
  it("履歴なしは控えめな既定値", () => {
    const f = estimateFitness([], now);
    expect(f.weeklyKm).toBeGreaterThan(0);
    expect(f.longestKm).toBeGreaterThan(0);
    expect(f.easyPaceSecPerKm).toBeGreaterThan(0);
  });

  it("直近の履歴から週間距離・最長・ペースを推定", () => {
    const acts: Activity[] = [
      {
        date: "2026-05-27",
        type: "ラン",
        title: "",
        distanceKm: 6,
        durationSec: 1800,
        avgPaceSecPerKm: 300,
        avgHr: 150,
        maxHr: 165,
        ascentM: 0,
      },
      {
        date: "2026-05-24",
        type: "ラン",
        title: "",
        distanceKm: 4,
        durationSec: 1320,
        avgPaceSecPerKm: 330,
        avgHr: 150,
        maxHr: 165,
        ascentM: 0,
      },
      {
        date: "2026-05-20",
        type: "ラン",
        title: "",
        distanceKm: 10,
        durationSec: 3000,
        avgPaceSecPerKm: 300,
        avgHr: 150,
        maxHr: 165,
        ascentM: 0,
      },
    ];
    const f = estimateFitness(acts, now);
    expect(f.longestKm).toBe(10);
    // 20km / 4週 = 5km/週
    expect(f.weeklyKm).toBeCloseTo(5, 1);
    // 平均ペース ~ (1800+1320+3000)/(6+4+10)=306 → +8% ≈ 330
    expect(f.easyPaceSecPerKm).toBeGreaterThan(320);
    expect(f.easyPaceSecPerKm).toBeLessThan(340);
  });
});

const RACE: Race = { id: "r1", name: "テストレース", date: "2026-08-24", distanceKm: 21.1 };
const START = "2026-06-01"; // 月曜
const fitness = {
  weeklyKm: 20,
  longestKm: 8,
  easyPaceSecPerKm: 360,
  currentVdot: 40,
  maxHrObserved: 185,
};

describe("generatePlan", () => {
  it("開始日からレース日まで毎日分を出力", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
    });
    expect(plan.length).toBe(diffDays(START, RACE.date) + 1);
    expect(plan[0]!.date).toBe(START);
    expect(plan[plan.length - 1]!.date).toBe(RACE.date);
  });

  it("レース日は race で距離=レース距離", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
    });
    const raceDay = plan.find((p) => p.date === RACE.date)!;
    expect(raceDay.type).toBe("race");
    expect(raceDay.distanceKm).toBe(21.1);
  });

  it("ロング走は確保時間最大の曜日(土)のみ・1回以上", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
    });
    const longs = plan.filter((p) => p.type === "long");
    expect(longs.length).toBeGreaterThan(0);
    for (const l of longs) expect(weekday(l.date)).toBe(6);
  });

  it("非練習日は休養", () => {
    const av = defaultAvailability(); // 月は非練習日
    const plan = generatePlan({ startDate: START, race: RACE, fitness, availability: av });
    const mondays = plan.filter((p) => weekday(p.date) === 1 && p.date !== RACE.date);
    for (const m of mondays) expect(m.type).toBe("rest");
  });

  it("スキップ日は休養になる", () => {
    const skip = "2026-06-06"; // 最初の土曜(ロング走予定)
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
      skippedDates: [skip],
    });
    const day = plan.find((p) => p.date === skip)!;
    expect(day.type).toBe("rest");
    expect(day.note).toContain("スキップ");
  });

  it("確保時間でキャップされる", () => {
    // 火曜(2)を練習日・10分だけにする → 火曜の練習は約10分に制限。
    const av: WeeklyAvailability = defaultAvailability().map((d, wd) =>
      wd === 2 ? { isPracticeDay: true, maxMinutes: 10 } : d
    );
    const plan = generatePlan({ startDate: START, race: RACE, fitness, availability: av });
    const tue = plan.find((p) => weekday(p.date) === 2 && p.type !== "rest")!;
    expect(tue.estMinutes).toBe(10);
    expect(tue.cappedByTime).toBe(true);
  });

  it("テーパーで最終週(レース週除く)はピーク週より減る", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
    });
    const weeks = summarizeByWeek(plan);
    const peak = Math.max(...weeks.map((w) => w.totalKm));
    const taperWeek = weeks[weeks.length - 2]; // レース週の一つ前
    expect(taperWeek!.totalKm).toBeLessThan(peak);
  });

  it("週の練習回数で可能日から本数を絞る（ロング走日は必ず含む・分散）", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
      runsPerWeek: 2,
    });
    const wk0 = plan.filter((p) => p.weekIndex === 0 && p.type !== "rest" && p.date !== RACE.date);
    const wds = new Set(wk0.map((p) => weekday(p.date)));
    expect(wk0.length).toBe(2); // 週2回
    expect(wds.has(6)).toBe(true); // 土(ロング走)は必須
    expect(wds.has(4)).toBe(false); // 木は分散の結果休養（土+火が選ばれる）
  });

  it("回数が可能日数を超えたら可能日数にクランプ", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
      runsPerWeek: 10,
    });
    const wk1 = plan.filter((p) => p.weekIndex === 1 && p.type !== "rest");
    expect(new Set(wk1.map((p) => weekday(p.date))).size).toBe(3); // 可能日=3
  });

  it("各週にポイント練習(isKey)が1つだけ立つ", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
    });
    const byWeek = new Map<number, number>();
    for (const p of plan) if (p.isKey) byWeek.set(p.weekIndex, (byWeek.get(p.weekIndex) ?? 0) + 1);
    const weeksWithRun = new Set(plan.filter((p) => p.type !== "rest").map((p) => p.weekIndex));
    // 走る日がある週は必ず 1 つ key を持つ
    for (const wk of weeksWithRun) expect(byWeek.get(wk)).toBe(1);
    // レース日は key（最優先）
    expect(plan.find((p) => p.date === RACE.date)!.isKey).toBe(true);
  });

  it("目標タイム設定時は VDOT ゾーンでペースが付く", () => {
    const raceWithGoal: Race = { ...RACE, goalTimeSec: 110 * 60 }; // ハーフ 1:50
    const plan = generatePlan({
      startDate: START,
      race: raceWithGoal,
      fitness,
      availability: defaultAvailability(),
    });
    const raceDay = plan.find((p) => p.type === "race")!;
    // レース当日のペース ≈ 目標ペース(110*60/21.1 ≈ 313 s/km)
    expect(Math.abs((raceDay.paceSecPerKm ?? 0) - Math.round((110 * 60) / 21.1))).toBeLessThan(3);
    // テンポはイージーより速い
    const tempo = plan.find((p) => p.type === "tempo");
    const easy = plan.find((p) => p.type === "easy");
    if (tempo && easy) expect(tempo.paceSecPerKm!).toBeLessThan(easy.paceSecPerKm!);
  });

  it("レースが過去なら空", () => {
    const plan = generatePlan({
      startDate: "2026-09-01",
      race: RACE,
      fitness,
      availability: defaultAvailability(),
    });
    expect(plan).toEqual([]);
  });

  it("非キャップのイージー走は 距離×ペース と整合", () => {
    const plan = generatePlan({
      startDate: START,
      race: RACE,
      fitness,
      availability: defaultAvailability(),
    });
    const easy = plan.find((p) => p.type === "easy" && !p.cappedByTime)!;
    expect(easy.estMinutes).toBe(Math.round((easy.distanceKm * fitness.easyPaceSecPerKm) / 60));
  });
});

describe("estimateFitness（負荷・Strava集計）", () => {
  const now = new Date("2026-06-01T00:00:00Z").getTime();
  // relativeEffort を一定間隔で持つラン群（直近28日に8本、被覆率100%）。
  const re = (date: string, relativeEffort: number): Activity => ({
    date,
    type: "ラン",
    title: "",
    distanceKm: 8,
    durationSec: 8 * 330,
    avgPaceSecPerKm: 330,
    avgHr: 150,
    maxHr: 170,
    ascentM: 0,
    relativeEffort,
  });

  it("relativeEffort が無い履歴では recentLoad=null（従来挙動）", () => {
    const acts: Activity[] = [
      { date: "2026-05-27", type: "ラン", title: "", distanceKm: 6, durationSec: 1800, avgPaceSecPerKm: 300, avgHr: 150, maxHr: 165, ascentM: 0 },
      { date: "2026-05-24", type: "ラン", title: "", distanceKm: 4, durationSec: 1320, avgPaceSecPerKm: 330, avgHr: 150, maxHr: 165, ascentM: 0 },
    ];
    expect(estimateFitness(acts, now).recentLoad).toBeNull();
  });

  it("被覆率が閾値未満なら recentLoad=null（中途半端な比を出さない）", () => {
    // 10本中 relativeEffort 持ちは 2本 = 20% < 60%。
    const acts: Activity[] = [];
    for (let i = 0; i < 8; i++) acts.push(re(`2026-05-${10 + i}`, 50));
    const withoutRE = acts.map((a) => ({ ...a, relativeEffort: undefined }));
    const mixed = [...withoutRE, re("2026-05-28", 50), re("2026-05-29", 50)];
    expect(estimateFitness(mixed, now).recentLoad).toBeNull();
  });

  it("急増(直近7日が高負荷)で ACWR>1.5 を算出", () => {
    const acts: Activity[] = [
      // 8-28日前: 低負荷（合計 500）
      re("2026-05-08", 100), re("2026-05-12", 100), re("2026-05-16", 100), re("2026-05-20", 100), re("2026-05-23", 100),
      // 直近7日: 高負荷（合計 350）
      re("2026-05-26", 150), re("2026-05-28", 100), re("2026-05-30", 100),
    ];
    const load = estimateFitness(acts, now).recentLoad;
    expect(load).not.toBeNull();
    // chronic = 850/4 = 212.5≈213, acute = 350, ratio ≈ 1.64
    expect(load!.ratio).toBeGreaterThan(1.5);
  });

  it("Strava 集計があれば weeklyKm を過小評価しないよう max 補正", () => {
    const acts: Activity[] = [
      { date: "2026-05-27", type: "ラン", title: "", distanceKm: 6, durationSec: 1800, avgPaceSecPerKm: 300, avgHr: 150, maxHr: 165, ascentM: 0 },
      { date: "2026-05-20", type: "ラン", title: "", distanceKm: 10, durationSec: 3000, avgPaceSecPerKm: 300, avgHr: 150, maxHr: 165, ascentM: 0 },
    ];
    const profile: AthleteProfile = {
      recentRunTotals: { distanceKm: 80, durationSec: 24000, count: 16 }, // 80/4=20km/週
    };
    const withoutProfile = estimateFitness(acts, now).weeklyKm; // 16/4=4km/週
    const withProfile = estimateFitness(acts, now, profile).weeklyKm;
    expect(withProfile).toBeGreaterThan(withoutProfile);
    expect(withProfile).toBeCloseTo(20, 1);
  });
});

describe("generatePlan（ACWR 増量補正）", () => {
  const baseFitness: Fitness = {
    weeklyKm: 20,
    longestKm: 8,
    easyPaceSecPerKm: 360,
    currentVdot: 40,
    maxHrObserved: 185,
    recentLoad: null,
  };
  const firstLongKm = (f: Fitness): number => {
    const plan = generatePlan({ startDate: START, race: RACE, fitness: f, availability: defaultAvailability() });
    return plan.find((p) => p.type === "long")!.distanceKm;
  };

  it("ACWR>1.5 のとき序盤のロング走が縮む（recentLoad=null と比較）", () => {
    const normal = firstLongKm(baseFitness);
    const spiking = firstLongKm({ ...baseFitness, recentLoad: { acute: 350, chronic: 200, ratio: 1.75 } });
    expect(spiking).toBeLessThan(normal);
  });

  it("recentLoad=null は recentLoad 未指定と一致（従来挙動）", () => {
    const a = generatePlan({ startDate: START, race: RACE, fitness: baseFitness, availability: defaultAvailability() });
    const legacy: Fitness = { ...baseFitness };
    delete (legacy as { recentLoad?: unknown }).recentLoad;
    const b = generatePlan({ startDate: START, race: RACE, fitness: legacy, availability: defaultAvailability() });
    expect(a).toEqual(b);
  });
});
