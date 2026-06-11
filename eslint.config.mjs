import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import stylistic from "@stylistic/eslint-plugin";
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
    // カスタムルール本体（プレーンな Node スクリプト）は意味論ルールの対象外。整形のみ当てる。
    ignores: ["scripts/**", "eslint-rules/**"],
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
  // --- 整形（JS/TS は Prettier ではなく @stylistic が担当する） ---
  // Prettier は printWidth に収まる型リテラルを必ず 1 行に潰し、これを止める設定が無いため撤去した。
  // customize のオプションと下記 override は旧 .prettierrc.json のスタイルに合わせている。
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs"],
    plugins: {
      "@stylistic": stylistic,
    },
    rules: {
      ...stylistic.configs.customize({
        arrowParens: true,
        braceStyle: "1tbs",
        indent: 2,
        jsx: true,
        quoteProps: "as-needed",
        quotes: "double",
        semi: true,
      }).rules,

      // エスケープ回避のための逆クォート（例: 内側に " を含む文字列のシングルクォート）は
      // 旧 Prettier 同様に許容する（customize は avoidEscape: false 固定のため上書き）。
      "@stylistic/quotes": ["error", "double", { allowTemplateLiterals: "always", avoidEscape: true }],

      // 旧 trailingComma: "es5" 相当（関数引数・generics には付けない）。
      "@stylistic/comma-dangle": [
        "error",
        {
          arrays: "always-multiline",
          objects: "always-multiline",
          imports: "always-multiline",
          exports: "always-multiline",
          functions: "never",
          enums: "always-multiline",
          generics: "never",
          tuples: "always-multiline",
        },
      ],

      // Prettier と同じ折り返し位置（&& や = は行末、三項演算子と union/intersection は行頭）。
      "@stylistic/operator-linebreak": [
        "error",
        "after",
        { overrides: { "?": "before", ":": "before", "|": "before", "&": "before" } },
      ],

      // 日本語の文章に <b> 等のインライン要素が混在するため、children の行分離は強制しない
      // （どの allow オプションでも文章ごと式単位に分解されてしまう）。改行は作者が管理する。
      "@stylistic/jsx-one-expression-per-line": "off",

      // 括弧内の改行は「最初の要素を改行したか」を基準に全要素へ揃える（幅基準は持たない）。
      // 型リテラルだけはメンバー数に関わらず常に複数行へ展開する。
      "@stylistic/exp-list-style": [
        "error",
        {
          overrides: {
            TSTypeLiteral: { singleLine: { maxItems: 0 } },
          },
        },
      ],
    },
  },
  ...storybook.configs["flat/recommended"],
];

export default config;
