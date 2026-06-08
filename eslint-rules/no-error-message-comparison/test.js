import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-error-message-comparison", rule, {
  valid: [
    // .type で判定する（推奨）。
    { code: `if (result.error.type === "config") {}` },
    // .message を比較以外で使うのは OK。
    { code: `const m = result.error.message;` },
    // message 以外のプロパティ比較は無関係。
    { code: `if (result.error.code === "E1") {}` },
  ],
  invalid: [
    {
      code: `if (result.error.message === "未設定") {}`,
      errors: [{ messageId: "noMessageComparison" }],
    },
    {
      code: `if (err.message !== "boom") {}`,
      errors: [{ messageId: "noMessageComparison" }],
    },
    // 左辺が文字列リテラルでも検出。
    {
      code: `if ("未設定" === e.message) {}`,
      errors: [{ messageId: "noMessageComparison" }],
    },
  ],
});
