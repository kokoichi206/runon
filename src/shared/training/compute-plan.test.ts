import { describe, expect, it } from "vitest";

import { computeTrainingPlan } from "@/shared/training/compute-plan";
import {
  defaultAvailability,
  trainingPlanRequestSchema,
  type Fitness,
  type TrainingPlanRequest,
} from "@/shared/types/training";

const fitness: Fitness = {
  weeklyKm: 30,
  longestKm: 12,
  easyPaceSecPerKm: 360,
  currentVdot: 45,
  maxHrObserved: 185,
};

/**
 * today から daysAhead 日後の YYYY-MM-DD を作る（固定計算、Date.now 非依存）。
 */
const ymdPlus = (base: string, daysAhead: number): string => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
};

const baseReq = (
  overrides: Partial<Extract<TrainingPlanRequest, {
    mode: "race";
  }>> = {}
): TrainingPlanRequest => ({
  mode: "race",
  today: "2026-01-01",
  race: {
    id: "r1",
    name: "テスト 10K",
    date: ymdPlus("2026-01-01", 70),
    distanceKm: 10,
  },
  fitness,
  availability: defaultAvailability(),
  runsPerWeek: 3,
  skippedDates: [],
  ...overrides,
});

describe("computeTrainingPlan", () => {
  it("未来のレースに対して週ごとの計画を生成する", () => {
    const result = computeTrainingPlan(baseReq());
    expect(result.plan.length).toBeGreaterThan(0);
    expect(result.weeks.length).toBeGreaterThan(0);
    // 各メニューの date は YYYY-MM-DD。
    for (const w of result.plan) {
      expect(w.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("目標タイム未設定なら progression は null", () => {
    const result = computeTrainingPlan(baseReq());
    expect(result.progression).toBeNull();
  });

  it("目標タイム設定時は progression を返す", () => {
    const result = computeTrainingPlan(
      baseReq({
        race: {
          id: "r2",
          name: "目標つき",
          date: ymdPlus("2026-01-01", 70),
          distanceKm: 10,
          goalTimeSec: 50 * 60,
        },
      })
    );
    expect(result.progression).not.toBeNull();
    expect(result.progression?.goalTimeSec).toBe(50 * 60);
  });

  it("過去のレースなら計画は空（progression も null）", () => {
    const result = computeTrainingPlan(
      baseReq({
        race: {
          id: "r3",
          name: "過去",
          date: "2025-01-01",
          distanceKm: 10,
          goalTimeSec: 50 * 60,
        },
      })
    );
    expect(result.plan).toEqual([]);
    expect(result.weeks).toEqual([]);
    expect(result.progression).toBeNull();
  });
});

describe("computeTrainingPlan（5km 強化ブロック）", () => {
  const blockReq = (overrides: Partial<Extract<TrainingPlanRequest, {
    mode: "block";
  }>> = {}): TrainingPlanRequest => ({
    mode: "block",
    today: "2026-01-05", // 月曜
    weeks: 12,
    targetDistanceKm: 5,
    fitness,
    availability: defaultAvailability(),
    runsPerWeek: 3,
    skippedDates: [],
    ...overrides,
  });

  it("週数×7 日を生成し、progression は null", () => {
    const result = computeTrainingPlan(blockReq());
    expect(result.plan.length).toBe(12 * 7);
    expect(result.weeks.length).toBe(12);
    expect(result.progression).toBeNull();
  });

  it("4 週ごと（第4・8・12週）に 3000m TT が入る", () => {
    const result = computeTrainingPlan(blockReq());
    const ttWeeks = new Set(
      result.plan.filter((p) => p.type === "timeTrial").map((p) => p.weekIndex)
    );
    expect([...ttWeeks].sort((a, b) => a - b)).toEqual([3, 7, 11]);
  });

  it("VDOT があれば T(tempo)/I(interval)/R(repetition) が各サイクルに現れる", () => {
    const types = new Set(computeTrainingPlan(blockReq()).plan.map((p) => p.type));
    expect(types.has("tempo")).toBe(true);
    expect(types.has("interval")).toBe(true);
    expect(types.has("repetition")).toBe(true);
  });

  it("VDOT 未取得なら強度走は出さず、TT は出す", () => {
    const noVdot: Fitness = {
      ...fitness,
      currentVdot: null,
    };
    const types = new Set(computeTrainingPlan(blockReq({
      fitness: noVdot,
    })).plan.map((p) => p.type));
    expect(types.has("interval")).toBe(false);
    expect(types.has("repetition")).toBe(false);
    expect(types.has("timeTrial")).toBe(true);
  });
});

describe("fitness.recentLoad の契約（サーバー検証経路）", () => {
  const spikingLoad = {
    acute: 350,
    chronic: 200,
    ratio: 1.75,
  };
  const raceReq = (recentLoad?: typeof spikingLoad) => ({
    mode: "race" as const,
    today: "2026-01-01",
    race: {
      id: "r1",
      name: "テスト 10K",
      date: ymdPlus("2026-01-01", 70),
      distanceKm: 10,
    },
    fitness: {
      weeklyKm: 30,
      longestKm: 12,
      easyPaceSecPerKm: 360,
      currentVdot: 45,
      maxHrObserved: 185,
      ...(recentLoad
        ? {
            recentLoad,
          }
        : {}),
    },
    availability: defaultAvailability(),
    runsPerWeek: 3,
  });

  it("検証(parse)後も recentLoad が保持される（ストリップされない）", () => {
    const parsed = trainingPlanRequestSchema.parse(raceReq(spikingLoad));
    expect(parsed.fitness.recentLoad).toEqual(spikingLoad);
  });

  it("検証経路でも ACWR 急増で序盤ロングが縮む（UI 表示と計画が一致）", () => {
    const firstLong = (req: unknown) => {
      const parsed = trainingPlanRequestSchema.parse(req);
      return computeTrainingPlan(parsed).plan.find((p) => p.type === "long")!.distanceKm;
    };
    // recentLoad 無し（factor=1.0）より、急増あり（factor=0.8）の方が小さい。
    expect(firstLong(raceReq(spikingLoad))).toBeLessThan(firstLong(raceReq()));
  });
});
