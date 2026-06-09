import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// 5 行を超えると違反、というオプションで検証する。
const opts = [{ maxLines: 5 }];

ruleTester.run("max-api-route-handler-lines", rule, {
  valid: [
    // route.ts でも上限以内。
    {
      code: `export function GET() {\n  return new Response("ok");\n}`,
      filename: "/project/src/app/api/ping/route.ts",
      options: opts,
    },
    // route.ts 以外は対象外（長くても OK）。
    {
      code: `const a=1;\nconst b=2;\nconst c=3;\nconst d=4;\nconst e=5;\nconst f=6;\nconst g=7;`,
      filename: "/project/src/server/handlers/x.ts",
      options: opts,
    },
    // 空行・コメントは数えない。
    {
      code: `// c1\n\n// c2\n\nexport function GET() {\n  return ok();\n}`,
      filename: "/project/src/app/api/ping/route.ts",
      options: [{ maxLines: 3 }],
    },
  ],
  invalid: [
    {
      code: `const a=1;\nconst b=2;\nconst c=3;\nconst d=4;\nconst e=5;\nconst f=6;`,
      filename: "/project/src/app/api/ping/route.ts",
      options: opts,
      errors: [{ messageId: "tooManyLines" }],
    },
  ],
});
