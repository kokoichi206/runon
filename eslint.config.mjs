import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import stylistic from "@stylistic/eslint-plugin";
import format from "eslint-plugin-format";
import importX from "eslint-plugin-import-x";
import jsoncPlugin from "eslint-plugin-jsonc";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import security from "eslint-plugin-security";
import storybook from "eslint-plugin-storybook";
import ymlPlugin from "eslint-plugin-yml";
import * as jsoncParser from "jsonc-eslint-parser";
import tseslint from "typescript-eslint";
import * as yamlParser from "yaml-eslint-parser";

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
      // 機械生成の YAML は整形対象外。
      "pnpm-lock.yaml",
      // Chrome 拡張 / API CLI（素のブラウザ・Node JS。アプリの型/lint 体系とは独立）は対象外。
      "tools/strava-bulk-uploader/",
      "tools/strava-api-uploader/",
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
      "no-console": ["error", {
        allow: ["warn", "error"],
      }],
      // null/undefined を同時に判定する == null / != null は許容し、それ以外は厳格比較。
      eqeqeq: ["error", "always", {
        null: "ignore",
      }],

      // 関数宣言ではなく const + アロー関数を強制する。
      "func-style": ["error", "expression"],

      // 環境変数は src/shared/env に集約する。直接参照を禁止し出処を一元化する。
      "no-process-env": "error",

      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: {
            order: "asc",
            caseInsensitive: true,
          },
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
    plugins: {
      custom: customRules,
    },
    rules: {
      "custom/no-throw-statement": "error",
    },
  },
  // API route は薄く保つ。
  {
    files: ["src/app/api/**/route.ts"],
    plugins: {
      custom: customRules,
    },
    rules: {
      "custom/max-api-route-handler-lines": ["error", {
        maxLines: 80,
      }],
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

      // 改行コードは LF に統一。
      "@stylistic/linebreak-style": ["error", "unix"],

      // エスケープ回避のための逆クォート（例: 内側に " を含む文字列のシングルクォート）は許容する。
      // （customize は avoidEscape: false 固定のため上書き）。
      "@stylistic/quotes": ["error", "double", {
        allowTemplateLiterals: "always",
        avoidEscape: true,
      }],

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
        {
          overrides: {
            "?": "before",
            ":": "before",
            "|": "before",
            "&": "before",
          },
        },
      ],

      // 日本語の文章に <b> 等のインライン要素が混在するため、children の行分離は強制しない
      // （どの allow オプションでも文章ごと式単位に分解されてしまう）。改行は作者が管理する。
      "@stylistic/jsx-one-expression-per-line": "off",

      // 括弧内の改行は「最初の要素を改行したか」を基準に全要素へ揃える（幅基準は持たない）。
      // 型リテラルと値オブジェクトはメンバー数に関わらず常に複数行へ展開する。
      // 配列は 1 行で意味が完結するリスト（["a", "b", "c"] 等）が多いため preserve のまま。
      "@stylistic/exp-list-style": [
        "error",
        {
          overrides: {
            TSTypeLiteral: {
              singleLine: {
                maxItems: 0,
              },
            },
            ObjectExpression: {
              singleLine: {
                maxItems: 0,
              },
            },
          },
        },
      ],
    },
  },
  // --- JSON / JSONC / JSON5（package.json, tsconfig.json, renovate.json5 等） ---
  {
    files: ["**/*.json", "**/*.jsonc", "**/*.json5"],
    languageOptions: {
      parser: jsoncParser,
    },
    plugins: {
      jsonc: jsoncPlugin,
    },
    rules: {
      "jsonc/no-bigint-literals": "error",
      "jsonc/no-binary-expression": "error",
      "jsonc/no-binary-numeric-literals": "error",
      "jsonc/no-dupe-keys": "error",
      "jsonc/no-escape-sequence-in-identifier": "error",
      "jsonc/no-floating-decimal": "error",
      "jsonc/no-hexadecimal-numeric-literals": "error",
      "jsonc/no-infinity": "error",
      "jsonc/no-multi-str": "error",
      "jsonc/no-nan": "error",
      "jsonc/no-number-props": "error",
      "jsonc/no-numeric-separators": "error",
      "jsonc/no-octal": "error",
      "jsonc/no-octal-escape": "error",
      "jsonc/no-octal-numeric-literals": "error",
      "jsonc/no-parenthesized": "error",
      "jsonc/no-plus-sign": "error",
      "jsonc/no-regexp-literals": "error",
      "jsonc/no-sparse-arrays": "error",
      "jsonc/no-template-literals": "error",
      "jsonc/no-undefined-value": "error",
      "jsonc/no-unicode-codepoint-escapes": "error",
      "jsonc/no-useless-escape": "error",
      "jsonc/space-unary-ops": "error",
      "jsonc/valid-json-number": "error",

      "jsonc/array-bracket-spacing": ["error", "never"],
      "jsonc/comma-dangle": ["error", "never"],
      "jsonc/comma-style": ["error", "last"],
      "jsonc/indent": ["error", 2],
      "jsonc/key-spacing": ["error", {
        afterColon: true,
        beforeColon: false,
      }],
      "jsonc/object-curly-newline": ["error", {
        consistent: true,
        multiline: true,
      }],
      "jsonc/object-curly-spacing": ["error", "always"],
      "jsonc/object-property-newline": ["error", {
        allowAllPropertiesOnSameLine: true,
      }],
      "jsonc/quote-props": "error",
      "jsonc/quotes": "error",
    },
  },
  // JSON5 は unquoted key とコメントが慣習のため、キーの引用は強制しない（renovate.json5 等）。
  // trailing comma も JSON5 では有効なので、JS 側のスタイルに合わせて複数行は必須にする。
  {
    files: ["**/*.json5"],
    rules: {
      "jsonc/quote-props": "off",
      "jsonc/comma-dangle": ["error", "always-multiline"],
    },
  },
  // --- YAML（.github/workflows 等） ---
  {
    files: ["**/*.yml", "**/*.yaml"],
    languageOptions: {
      parser: yamlParser,
    },
    plugins: {
      yml: ymlPlugin,
    },
    rules: {
      "yml/block-mapping": "error",
      "yml/block-sequence": "error",
      "yml/no-empty-key": "error",
      "yml/no-empty-sequence-entry": "error",
      "yml/no-irregular-whitespace": "error",
      "yml/plain-scalar": "error",

      "yml/block-mapping-question-indicator-newline": "error",
      "yml/block-sequence-hyphen-indicator-newline": "error",
      "yml/flow-mapping-curly-newline": "error",
      "yml/flow-mapping-curly-spacing": "error",
      "yml/flow-sequence-bracket-newline": "error",
      "yml/flow-sequence-bracket-spacing": "error",
      "yml/indent": ["error", 2],
      "yml/key-spacing": "error",
      "yml/no-tab-indent": "error",
      "yml/quotes": ["error", {
        avoidEscape: true,
        prefer: "double",
      }],
      "yml/spaced-comment": "error",
    },
  },
  // --- CSS（globals.css。旧 Prettier と同一の整形を ESLint 経由で当てる） ---
  {
    files: ["**/*.css"],
    languageOptions: {
      parser: format.parserPlain,
    },
    plugins: {
      format,
    },
    rules: {
      // printWidth は旧 .prettierrc.json と同じ 100（デフォルト 80 だと既存ファイルが巻き直される）。
      "format/prettier": ["error", {
        parser: "css",
        printWidth: 100,
      }],
    },
  },
  // --- Markdown（第一級ドキュメント。整形の実行系統は ESLint 一本に保つ） ---
  // eslint-plugin-format がファイル全文を Prettier に通し、差分を autofix として適用する。
  {
    files: ["**/*.md"],
    languageOptions: {
      parser: format.parserPlain,
    },
    plugins: {
      format,
    },
    rules: {
      // proseWrap は preserve 厳守（always は日本語文の途中で改行されレンダリングが崩れる）。
      // コードフェンス内は @stylistic のスタイルと衝突するため Prettier に触らせない。
      "format/prettier": [
        "error",
        {
          parser: "markdown",
          proseWrap: "preserve",
          embeddedLanguageFormatting: "off",
        },
      ],
    },
  },
  ...storybook.configs["flat/recommended"],
];

export default config;
