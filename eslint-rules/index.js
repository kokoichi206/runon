/**
 * runon 独自の ESLint ルール群。
 * レイヤードアーキテクチャ（app → handlers → usecases → repositories/lib, shared は leaf）と
 * Result 型によるエラー処理規約をコードで強制する。
 *
 * 各ルールは <name>/ ディレクトリに rule.js / test.js / README.md を持つ。
 * テストは `pnpm test`（vitest, eslint-rules/**​/test.js）で実行する。
 */
import maxApiRouteHandlerLines from "./max-api-route-handler-lines/rule.js";
import noBrowserNotifications from "./no-browser-notifications/rule.js";
import noDirectLayerImport from "./no-direct-layer-import/rule.js";
import noDirectServerImport from "./no-direct-server-import/rule.js";
import noDynamicEnvAccess from "./no-dynamic-env-access/rule.js";
import noErrorMessageComparison from "./no-error-message-comparison/rule.js";
import noRelativeImportsAcrossLayers from "./no-relative-imports-across-layers/rule.js";
import noSingleLineBlockComment from "./no-single-line-block-comment/rule.js";
import noThrowStatement from "./no-throw-statement/rule.js";
import noToLocaleString from "./no-to-locale-string/rule.js";

export default {
  rules: {
    "max-api-route-handler-lines": maxApiRouteHandlerLines,
    "no-browser-notifications": noBrowserNotifications,
    "no-direct-layer-import": noDirectLayerImport,
    "no-direct-server-import": noDirectServerImport,
    "no-dynamic-env-access": noDynamicEnvAccess,
    "no-error-message-comparison": noErrorMessageComparison,
    "no-relative-imports-across-layers": noRelativeImportsAcrossLayers,
    "no-single-line-block-comment": noSingleLineBlockComment,
    "no-throw-statement": noThrowStatement,
    "no-to-locale-string": noToLocaleString,
  },
};
