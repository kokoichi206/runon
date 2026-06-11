import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("no-relative-imports-across-layers", rule, {
  valid: [
    // 同一層内の相対 import は許可。
    {
      code: `import { foo } from "../lib/foo";`,
      filename: "/project/src/server/usecases/bar.ts",
    },
    // 絶対パス（@/*）は許可。
    {
      code: `import { foo } from "@/server/handlers/foo";`,
      filename: "/project/src/app/page.tsx",
    },
    // shared への参照はどこからでも許可。
    {
      code: `import { ok } from "../../shared/result";`,
      filename: "/project/src/server/usecases/bar.ts",
    },
  ],
  invalid: [
    // app → server を相対で参照（handlers 経由・絶対パスにすべき）。
    {
      code: `import { compute } from "../../server/usecases/compute";`,
      filename: "/project/src/app/api/round-trip/route.ts",
      errors: [{
        messageId: "noRelativeImportAcrossLayers",
      }],
    },
    // client → app の相互参照。
    {
      code: `import { x } from "../../app/foo";`,
      filename: "/project/src/client/components/Foo.tsx",
      errors: [{
        messageId: "noRelativeImportAcrossLayers",
      }],
    },
  ],
});
