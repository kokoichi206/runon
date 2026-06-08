import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

import customRules from "./eslint-rules/index.js";

export default [
  {
    ignores: [
      "node_modules/",
      ".next/",
      "storybook-static/",
      "coverage/",
      "public/",
      // カスタムルール定義自体は lint 対象外
      "eslint-rules/",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      custom: customRules,
      "react-hooks": reactHooks,
    },
    rules: {
      // 1行ブロックコメントを禁止し複数行へ展開する。
      "custom/no-single-line-block-comment": "error",
      // 関数宣言ではなく const + アロー関数を強制する。
      "func-style": ["error", "expression"],
      // React Hooks のルール。
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
