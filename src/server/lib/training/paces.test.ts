import { describe, expect, it } from "vitest";

import {
  buildProgression,
  estimateCurrentVdot,
  predictTimeSec,
  trainingPaces,
  vdotFromPerformance,
} from "@/server/lib/training/paces";
import type { Activity } from "@/shared/types/training";

describe("VDOT モデル", () => {
  it("5K 20:00 の VDOT は ~49.8（Daniels テーブル一致）", () => {
    const v = vdotFromPerformance(5, 20 * 60);
    expect(v).toBeGreaterThan(48.5);
    expect(v).toBeLessThan(51);
  });

  it("10K 40:00 の VDOT は ~50", () => {
    const v = vdotFromPerformance(10, 40 * 60);
    expect(v).toBeGreaterThan(48);
    expect(v).toBeLessThan(52);
  });

  it("predictTimeSec は vdotFromPerformance の逆（ラウンドトリップ）", () => {
    const t = 42 * 60; // 10K 42:00
    const v = vdotFromPerformance(10, t);
    const back = predictTimeSec(v, 10);
    expect(Math.abs(back - t)).toBeLessThan(3); // 3 秒以内
  });

  it("VDOT50 のゾーンペースが Daniels テーブルに近い & 速い順", () => {
    const p = trainingPaces(50);
    // I 3:50/km(230s), T 4:15/km(255s), M 4:25/km(265s), E 5:07/km(307s) 付近
    expect(Math.abs(p.interval - 230)).toBeLessThan(8);
    expect(Math.abs(p.threshold - 255)).toBeLessThan(8);
    expect(Math.abs(p.marathon - 265)).toBeLessThan(8);
    expect(Math.abs(p.easy - 307)).toBeLessThan(12);
    // 速い→遅い: I < T < M < E
    expect(p.interval).toBeLessThan(p.threshold);
    expect(p.threshold).toBeLessThan(p.marathon);
    expect(p.marathon).toBeLessThan(p.easy);
  });

  it("速い目標ほど VDOT が高い（単調）", () => {
    expect(vdotFromPerformance(10, 40 * 60)).toBeGreaterThan(
      vdotFromPerformance(10, 50 * 60),
    );
  });
});

describe("buildProgression（伸ばし方/実現可能性）", () => {
  it("currentVdot 不明なら feasibility=不明", () => {
    const p = buildProgression(null, 50 * 60, 10, 12);
    expect(p.feasibility).toBe("不明");
    expect(p.predictedCurrentTimeSec).toBeNull();
    expect(p.currentPaces).toBeNull();
  });

  it("現状で既に目標到達なら現実的・改善0", () => {
    const cur = vdotFromPerformance(10, 45 * 60); // 既に45分の力
    const p = buildProgression(cur, 50 * 60, 10, 12); // 目標は50分(易しい)
    expect(p.feasibility).toBe("現実的");
    expect(p.requiredImprovementPct).toBe(0);
  });

  it("過大な目標は厳しいと判定", () => {
    const cur = vdotFromPerformance(10, 60 * 60); // 60分の力
    const p = buildProgression(cur, 38 * 60, 10, 6); // 6週で38分は無理筋
    expect(p.feasibility).toBe("厳しい");
    expect(p.requiredImprovementPct).toBeGreaterThan(0);
  });
});

describe("estimateCurrentVdot（実測優先）", () => {
  const now = new Date("2026-06-01T00:00:00Z").getTime();
  const slowRun = (extra?: Partial<Activity>): Activity => ({
    date: "2026-05-25",
    type: "ラン",
    title: "",
    distanceKm: 15,
    durationSec: 15 * 360, // 6:00/km の遅い走（全体平均だと低い VDOT）
    avgPaceSecPerKm: 360,
    avgHr: 140,
    maxHr: 160,
    ascentM: 0,
    ...extra,
  });

  it("best_efforts(5k) があれば全体平均より高い VDOT を採る", () => {
    const withBE = estimateCurrentVdot(
      [slowRun({ bestEfforts: [{ name: "5k", distanceM: 5000, timeSec: 20 * 60 }] })],
      now,
    );
    const without = estimateCurrentVdot([slowRun()], now);
    expect(withBE).not.toBeNull();
    expect(without).not.toBeNull();
    expect(withBE!).toBeGreaterThan(without!);
    expect(withBE!).toBeGreaterThan(48); // 5k 20:00 ≒ VDOT 49.8
  });

  it("短距離(<3km)の best_effort は過大評価防止のため無視", () => {
    const short = estimateCurrentVdot(
      [slowRun({ bestEfforts: [{ name: "1k", distanceM: 1000, timeSec: 3 * 60 }] })],
      now,
    );
    const without = estimateCurrentVdot([slowRun()], now);
    expect(short).toBe(without);
  });

  it("workoutKind=race は実測として採用", () => {
    const race: Activity = {
      date: "2026-05-25",
      type: "ラン",
      title: "",
      distanceKm: 10,
      durationSec: 40 * 60,
      avgPaceSecPerKm: 240,
      avgHr: 175,
      maxHr: 185,
      ascentM: 0,
      workoutKind: "race",
    };
    const v = estimateCurrentVdot([race], now);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(48); // 10k 40:00 ≒ VDOT 50
  });
});
