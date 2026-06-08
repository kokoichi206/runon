import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-browser-notifications", rule, {
  valid: [
    { code: `showToast("保存しました");` },
    // 別名の関数は対象外。
    { code: `confirmOrder();` },
    { code: `const x = window.location.href;` },
  ],
  invalid: [
    {
      code: `alert("hi");`,
      errors: [{ messageId: "noBrowserNotification", data: { name: "alert" } }],
    },
    {
      code: `const ok = confirm("よろしいですか");`,
      errors: [{ messageId: "noBrowserNotification" }],
    },
    {
      code: `window.prompt("名前");`,
      errors: [{ messageId: "noBrowserNotification" }],
    },
    {
      code: `globalThis.alert("x");`,
      errors: [{ messageId: "noBrowserNotification" }],
    },
  ],
});
