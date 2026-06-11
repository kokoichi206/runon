import { describe, expect, it } from "vitest";

import { computeTrainingPlan } from "@/shared/training/compute-plan";
import {
  defaultAvailability,
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

const baseReq = (overrides: Partial<TrainingPlanRequest> = {}): TrainingPlanRequest => ({
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
