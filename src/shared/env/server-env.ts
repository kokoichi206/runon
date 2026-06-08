import { z } from "zod";

const emptyStringToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

/**
 * サーバー環境変数。すべて任意（未設定ならコード内の既定値を使う）。
 * 暗黙的フォールバックを避けるため、空文字は undefined に正規化し
 * 明示的な既定値のみを定義側に持たせる。
 */
const serverEnvSchema = z.object({
  // 公開 Overpass を避けて自前インスタンスを使う場合に指定。
  OVERPASS_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  // OSM 利用エチケット用の User-Agent。
  OVERPASS_USER_AGENT: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),

  // Strava OAuth（任意）。両方そろって初めて連携が有効になる。
  STRAVA_CLIENT_ID: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  STRAVA_CLIENT_SECRET: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  // redirect の基底 URL。未設定ならリクエストの origin を使う。
  STRAVA_REDIRECT_BASE: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  // OG 画像など絶対 URL の解決に使う公開 URL。未設定ならローカル既定値を使う。
  SITE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
});

export const serverEnv = serverEnvSchema.parse({
  OVERPASS_ENDPOINT: process.env.OVERPASS_ENDPOINT,
  OVERPASS_USER_AGENT: process.env.OVERPASS_USER_AGENT,
  STRAVA_CLIENT_ID: process.env.STRAVA_CLIENT_ID,
  STRAVA_CLIENT_SECRET: process.env.STRAVA_CLIENT_SECRET,
  STRAVA_REDIRECT_BASE: process.env.STRAVA_REDIRECT_BASE,
  SITE_URL: process.env.SITE_URL,
});

/**
 * Strava 連携が設定済みか（Client ID/Secret がそろっているか）。
 */
export const isStravaConfigured = (): boolean =>
  serverEnv.STRAVA_CLIENT_ID !== undefined && serverEnv.STRAVA_CLIENT_SECRET !== undefined;
