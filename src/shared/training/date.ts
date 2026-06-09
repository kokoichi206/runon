/**
 * YYYY-MM-DD を UTC 正午基準で扱う日付ユーティリティ。
 * タイムゾーンによる日付ずれを避けるため、すべて UTC で計算する。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "YYYY-MM-DD" -> UTC エポックミリ秒（その日の 00:00 UTC）。
 */
export const parseYmd = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
};

/**
 * UTC エポックミリ秒 -> "YYYY-MM-DD"。
 */
export const formatYmd = (ms: number): string => {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const addDays = (ymd: string, days: number): string => {
  return formatYmd(parseYmd(ymd) + days * DAY_MS);
};

/**
 * 2 日付間の日数（end - start）。
 */
export const diffDays = (startYmd: string, endYmd: string): number => {
  return Math.round((parseYmd(endYmd) - parseYmd(startYmd)) / DAY_MS);
};

/**
 * 曜日（0=日..6=土）。
 */
export const weekday = (ymd: string): number => {
  return new Date(parseYmd(ymd)).getUTCDay();
};

/**
 * ISO 日時文字列 -> "YYYY-MM-DD"（ローカル日付）。CSV の活動日をまとめる用途。
 */
export const isoToYmdLocal = (iso: string): string => {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso.slice(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
