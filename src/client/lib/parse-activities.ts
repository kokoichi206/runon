import type { Activity } from "@/shared/types/training";

/**
 * クォート・カンマを考慮した最小 CSV パーサ。1 セル内の改行は非対応（Garmin 出力では不要）。
 */
const parseCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
};

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(v) ? v : null;
};

/**
 * "HH:MM:SS" / "MM:SS" / "M:SS.s" -> 秒。
 */
const toSeconds = (s: string | undefined): number | null => {
  if (!s) return null;
  const parts = s.trim().split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 1) return parts[0]!;
  return null;
};

// Garmin 日本語ヘッダ -> 内部キー。英語ヘッダにも一部対応。
const HEADER_MAP: Record<string, string> = {
  アクティビティタイプ: "type",
  "Activity Type": "type",
  日付: "date",
  Date: "date",
  タイトル: "title",
  Title: "title",
  距離: "distance",
  Distance: "distance",
  タイム: "time",
  Time: "time",
  平均ペース: "avgPace",
  "Avg Pace": "avgPace",
  平均心拍数: "avgHr",
  "Avg HR": "avgHr",
  最大心拍数: "maxHr",
  "Max HR": "maxHr",
  総上昇量: "ascent",
  "Total Ascent": "ascent",
};

/**
 * CSV テキストを Activity[] に変換する。
 * 距離・タイムが取れない行は除外する（暗黙に 0 埋めしない）。
 */
export const parseActivities = (text: string): Activity[] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]!);
  const colIndex: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = HEADER_MAP[h.trim()];
    if (key && !(key in colIndex)) colIndex[key] = i;
  });

  // 必須列が無ければパース不能。
  if (colIndex.date === undefined || colIndex.distance === undefined) {
    return [];
  }

  const activities: Activity[] = [];
  for (let r = 1; r < lines.length; r++) {
    const f = parseCsvLine(lines[r]!);
    const get = (key: string) =>
      colIndex[key] !== undefined ? f[colIndex[key]!] : undefined;

    const distanceKm = num(get("distance"));
    const durationSec = toSeconds(get("time"));
    const rawDate = get("date")?.trim();
    if (!rawDate || distanceKm === null || durationSec === null) continue;
    if (distanceKm <= 0 || durationSec <= 0) continue;

    activities.push({
      date: rawDate,
      type: get("type")?.trim() ?? "",
      title: get("title")?.trim() ?? "",
      distanceKm,
      durationSec,
      avgPaceSecPerKm: toSeconds(get("avgPace")),
      avgHr: num(get("avgHr")),
      maxHr: num(get("maxHr")),
      ascentM: num(get("ascent")),
    });
  }

  // 新しい順。
  activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return activities;
};
