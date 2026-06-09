import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-throw-statement", rule, {
  valid: [
    // Result を返す（throw しない）。
    {
      code: `
        function validateInput(input) {
          if (!input) return err("required");
          return ok(input);
        }
      `,
    },
    // 外部エラーの catch は許可（throw していない）。
    {
      code: `
        function handleExternal() {
          try {
            external();
          } catch (cause) {
            return err(cause);
          }
        }
      `,
    },
  ],
  invalid: [
    {
      code: `throw new Error("boom");`,
      errors: [{ messageId: "noThrowStatement" }],
    },
    {
      code: `
        function process(value) {
          if (!value) throw new Error("required");
          if (value < 0) throw new Error("negative");
          return value;
        }
      `,
      errors: [{ messageId: "noThrowStatement" }, { messageId: "noThrowStatement" }],
    },
    // catch 内での再 throw も禁止。
    {
      code: `
        try {
          doSomething();
        } catch (cause) {
          throw cause;
        }
      `,
      errors: [{ messageId: "noThrowStatement" }],
    },
  ],
});
