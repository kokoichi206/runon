import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import storybook from "eslint-plugin-storybook";
import tseslint from "typescript-eslint";

import customRules from "./eslint-rules/index.js";

/**
 * @type {import("eslint").Linter.Config[]}
 */
const config = [
  {
    ignores: [
      "node_modules/",
      ".next/",
      "out/",
      "build/",
      "coverage/",
      "storybook-static/",
      "next-env.d.ts",
      "public/",
      "design/",
      // カスタムルール本体（プレーンな Node スクリプト）は対象外。
      "eslint-rules/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs"],
    ignores: ["scripts/**"],
    plugins: {
      "import-x": importX,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      security: security,
      custom: customRules,
    },
    settings: {
      // @/* は tsconfig の paths による内部エイリアス。import 順序判定で internal 扱いにする。
      "import-x/internal-regex": "^@/",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      // no-non-null-assertion は有効化しない。tsconfig の noUncheckedIndexedAccess により
      // 配列アクセスが T | undefined になるため、周回路アルゴリズム等のタイトなループでは
      // arr[i]! が意図的なイディオムになっている。
      "no-console": ["error", { allow: ["warn", "error"] }],
      // null/undefined を同時に判定する == null / != null は許容し、それ以外は厳格比較。
      eqeqeq: ["error", "always", { null: "ignore" }],

      // 関数宣言ではなく const + アロー関数を強制する。
      "func-style": ["error", "expression"],

      // 環境変数は src/shared/env に集約する。直接参照を禁止し出処を一元化する。
      "no-process-env": "error",

      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      ...jsxA11y.configs.recommended.rules,

      ...security.configs.recommended.rules,
      // TypeScript の型チェックで十分なため、false positive が多い detect-object-injection は無効化
      "security/detect-object-injection": "off",

      // --- runon 独自ルール（全層共通） ---
      "custom/no-single-line-block-comment": "error",
      "custom/no-dynamic-env-access": "error",
      "custom/no-error-message-comparison": "error",
      "custom/no-to-locale-string": "error",
      "custom/no-browser-notifications": "error",
      "custom/no-relative-imports-across-layers": "error",
      "custom/no-direct-server-import": "error",
      "custom/no-direct-layer-import": "error",
    },
  },
  // server 層は throw を禁止し Result 型でエラーを表現する（pure な lib も含む）。
  // テストは Result の型ナローイング等で意図的に throw するため対象外。
  {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/**/*.test.ts"],
    plugins: { custom: customRules },
    rules: {
      "custom/no-throw-statement": "error",
    },
  },
  // API route は薄く保つ。
  {
    files: ["src/app/api/**/route.ts"],
    plugins: { custom: customRules },
    rules: {
      "custom/max-api-route-handler-lines": ["error", { maxLines: 80 }],
    },
  },
  // env 定義モジュールと設定ファイルでは process.env の直接参照を許可する。
  {
    files: ["src/shared/env/**/*.ts", "next.config.ts"],
    rules: {
      "no-process-env": "off",
    },
  },
  // 調査・実験用スクリプトはルールを緩和する。
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      "no-process-env": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
  ...storybook.configs["flat/recommended"],
];

export default config;
