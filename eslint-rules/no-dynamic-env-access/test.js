import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-dynamic-env-access", rule, {
  valid: [
    // 静的アクセスは許可。
    { code: `const x = process.env.SITE_URL;` },
    // serverEnv 経由は当然 OK。
    { code: `const x = serverEnv.SITE_URL;` },
    // env 以外の computed access は無関係。
    { code: `const x = obj[key];` },
  ],
  invalid: [
    {
      code: `const x = process.env[key];`,
      errors: [{ messageId: "noDynamicEnvAccess" }],
    },
    {
      code: `const name = "SITE_URL"; const x = process.env[name];`,
      errors: [{ messageId: "noDynamicEnvAccess" }],
    },
  ],
});
