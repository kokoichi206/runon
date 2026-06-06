import { describe, expect, it } from "vitest";

import { bpmRange, hrZones, observedMaxHr, zoneForWorkout } from "@/server/training/heart-rate";
import type { Activity } from "@/shared/types/training";

const act = (maxHr: number | null): Activity => ({
  date: "2026-05-20",
  type: "ラン",
  title: "",
  distanceKm: 5,
  durationSec: 1800,
  avgPaceSecPerKm: 360,
  avgHr: 150,
  maxHr,
  ascentM: 0,
});

describe("heart-rate", () => {
  it("observedMaxHr は最大心拍の最大値、無ければ null", () => {
    expect(observedMaxHr([act(170), act(185), act(160)])).toBe(185);
    expect(observedMaxHr([act(null)])).toBeNull();
    expect(observedMaxHr([])).toBeNull();
  });

  it("hrZones は %HRmax で 5 ゾーン・昇順・連続", () => {
    const z = hrZones(190);
    expect(z).toHaveLength(5);
    expect(z[0]!.minBpm).toBe(95); // 50%
    expect(z[4]!.maxBpm).toBe(190); // 100%
    for (let i = 0; i + 1 < z.length; i++) {
      expect(z[i]!.maxBpm).toBeLessThanOrEqual(z[i + 1]!.minBpm + 1);
      expect(z[i]!.zone).toBeLessThan(z[i + 1]!.zone);
    }
  });

  it("種別ごとの推奨ゾーン（easy<tempo<interval）", () => {
    expect(zoneForWorkout("easy")).toBe(2);
    expect(zoneForWorkout("tempo")).toBe(4);
    expect(zoneForWorkout("interval")).toBe(5);
    expect(zoneForWorkout("rest")).toBeUndefined();
  });

  it("bpmRange はゾーンの範囲文字列", () => {
    expect(bpmRange(190, 2)).toBe("114–133");
  });
});
