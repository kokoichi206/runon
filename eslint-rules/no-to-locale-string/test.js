import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-to-locale-string", rule, {
  valid: [
    { code: `const s = new Intl.NumberFormat("ja-JP").format(value);` },
    // 別名メソッドは対象外。
    { code: `const s = value.toString();` },
  ],
  invalid: [
    {
      code: `const s = value.toLocaleString("ja-JP");`,
      errors: [{ messageId: "noToLocaleString" }],
    },
    {
      code: `const s = date.toLocaleString();`,
      errors: [{ messageId: "noToLocaleString" }],
    },
  ],
});
