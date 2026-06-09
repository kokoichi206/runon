/**
 * 起動中のローカル API に対する実データ（Overpass）スモークテスト。
 * 使い方:
 *   pnpm dev              # 別ターミナルでサーバ起動
 *   pnpm rt:smoke         # 既定: 東京駅 3km 徒歩
 *   LAT=34.985 LNG=135.758 KM=5 PROFILE=bike pnpm rt:smoke
 */
const base = process.env.BASE_URL ?? "http://localhost:3077";
const lat = Number(process.env.LAT ?? 35.681);
const lng = Number(process.env.LNG ?? 139.767);
const targetMeters = Math.round(Number(process.env.KM ?? 3) * 1000);
const profile = process.env.PROFILE ?? "walk";

async function main(): Promise<void> {
  const started = Date.now();
  const res = await fetch(`${base}/api/round-trip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng, targetMeters, profile }),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error(`NG (HTTP ${res.status}):`, json);
    process.exit(1);
  }
  console.log(`OK (${Date.now() - started}ms, HTTP ${res.status})`);
  console.log(`start=${JSON.stringify(json.start)} 目標=${targetMeters}m profile=${profile}`);
  console.log(
    `graph: nodes=${json.stats.graphNodes} edges=${json.stats.graphEdges} reachable=${json.stats.reachableNodes} computeMs=${json.stats.computeMs} overpassMs=${json.stats.overpassMs}`
  );
  console.log(`候補 ${json.candidates.length} 件:`);
  for (const c of json.candidates.slice(0, 8)) {
    console.log(
      `  ${c.id}${c.id === json.recommendedId ? " (推奨)" : ""}: ` +
        `len=${(c.lengthMeters / 1000).toFixed(2)}km 誤差=${c.lengthError}m ` +
        `重複=${c.overlapPercent}% src=${c.source} pts=${c.path.length}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
