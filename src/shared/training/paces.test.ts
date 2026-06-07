import { describe, expect, it } from "vitest";

import {
  buildProgression,
  predictTimeSec,
  trainingPaces,
  vdotFromPerformance,
} from "@/shared/training/paces";

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
    expect(vdotFromPerformance(10, 40 * 60)).toBeGreaterThan(vdotFromPerformance(10, 50 * 60));
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
