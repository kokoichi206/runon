/**
 * アプリ共通のエラー型。層をまたいで Result<T, AppError> として返し、
 * route handler で HTTP ステータスへ変換する。cause は元エラー（ログ用、レスポンスには出さない）。
 */
export type ErrorType =
  | "validation" // 入力不正
  | "config" // サーバー設定不足（例: Strava 未設定）
  | "unauthorized" // 認証/連携なし
  | "not_found"
  | "upstream" // 外部 API / ネットワークの失敗
  | "internal"; // 想定外

export interface AppError {
  type: ErrorType;
  /**
   * ユーザー向けメッセージ（日本語）。内部実装の詳細は載せない。
   */
  message: string;
  /**
   * 元エラー。ログ/デバッグ用でレスポンスには含めない。
   */
  cause?: unknown;
}

export const appError = {
  validation: (message: string, cause?: unknown): AppError => ({ type: "validation", message, cause }),
  config: (message: string, cause?: unknown): AppError => ({ type: "config", message, cause }),
  unauthorized: (message: string, cause?: unknown): AppError => ({ type: "unauthorized", message, cause }),
  notFound: (message: string, cause?: unknown): AppError => ({ type: "not_found", message, cause }),
  upstream: (message: string, cause?: unknown): AppError => ({ type: "upstream", message, cause }),
  internal: (message: string, cause?: unknown): AppError => ({ type: "internal", message, cause }),
};

const STATUS: Record<ErrorType, number> = {
  validation: 422,
  config: 400,
  unauthorized: 401,
  not_found: 404,
  upstream: 502,
  internal: 500,
};

/**
 * AppError を HTTP ステータスコードへ変換する（route handler 用）。
 */
export const httpStatusFor = (error: AppError): number => STATUS[error.type];

const USER_ERROR_TYPES = new Set<ErrorType>(["validation", "config", "unauthorized", "not_found"]);

/**
 * ユーザー起因のエラーか（true ならクライアント責任、false ならサーバー/外部起因）。
 */
export const isUserError = (error: AppError): boolean => USER_ERROR_TYPES.has(error.type);
