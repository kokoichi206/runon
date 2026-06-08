/**
 * テーマ管理の単一ソース。
 * - mode: ユーザーの選択（system / light / dark）を localStorage に保存。
 * - resolved: 実際に適用する light/dark。mode=system のとき OS 設定を見て決める。
 * 適用は <html data-theme> 属性で行い、色は globals.css の CSS 変数が切り替わる。
 */
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "runon:theme";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export const resolveTheme = (mode: ThemeMode): ResolvedTheme => {
  if (mode === "system") {
    return typeof window !== "undefined" && window.matchMedia(SYSTEM_DARK_QUERY).matches
      ? "dark"
      : "light";
  }
  return mode;
};

/**
 * 各テーマでのページ背景色（ブラウザクロム/PWA の theme-color に使う）。--bg と一致させる。
 */
const THEME_BG: Record<ResolvedTheme, string> = {
  dark: "#0b0e11",
  light: "#fbfaf8",
};

/**
 * ブラウザのアドレスバー/ステータスバー色を実テーマへ追従させる。
 * static metadata の theme-color は prefers-color-scheme 依存で、アプリ内のテーマ選択を反映できないため、
 * 実行時に専用 meta を head 末尾へ挿入して上書きする（最後に適用される meta が勝つ）。
 */
const syncThemeColorMeta = (resolved: ResolvedTheme): void => {
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-runon]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("data-runon", "");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", THEME_BG[resolved]);
};

/**
 * <html> に解決済みテーマと選択モードを反映する。
 */
export const applyTheme = (mode: ThemeMode): ResolvedTheme => {
  const resolved = resolveTheme(mode);
  const el = document.documentElement;
  el.dataset.theme = resolved;
  el.dataset.themeMode = mode;
  syncThemeColorMeta(resolved);
  return resolved;
};

export const readStoredMode = (): ThemeMode => {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    // ストレージ不可（Cookie 全ブロック/サンドボックス iframe 等）。OS 追従の既定にフォールバック。
    return "system";
  }
};

export const storeMode = (mode: ThemeMode): void => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // プライベートモード等で保存不可。テーマは当該セッション内では効くので無視する。
  }
};

/**
 * 初回描画前に <head> で同期実行し、チラつき(FOUC)を防ぐスクリプト。
 * React ハイドレーション前に data-theme を確定させる。STORAGE_KEY を共有するため文字列で持つ。
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY
)};var m=localStorage.getItem(k);if(m!=="light"&&m!=="dark"&&m!=="system")m="system";var d=m==="dark"||(m==="system"&&matchMedia(${JSON.stringify(
  SYSTEM_DARK_QUERY
)}).matches);var e=document.documentElement;e.dataset.theme=d?"dark":"light";e.dataset.themeMode=m;}catch(e){document.documentElement.dataset.theme="dark";}})();`;
