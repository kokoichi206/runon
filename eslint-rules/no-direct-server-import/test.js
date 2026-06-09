import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-direct-server-import", rule, {
  valid: [
    // 外部から handlers の参照は許可。
    {
      code: `import { roundTripHandler } from "@/server/handlers/round-trip-handler";`,
      filename: "/project/src/app/api/round-trip/route.ts",
    },
    // src/server 内からの @/server/* は許可。
    {
      code: `import { computeRoundTrips } from "@/server/usecases/compute-round-trips";`,
      filename: "/project/src/server/handlers/round-trip-handler.ts",
    },
    // shared への参照は対象外。
    {
      code: `import { ok } from "@/shared/result";`,
      filename: "/project/src/client/components/Foo.tsx",
    },
  ],
  invalid: [
    // client から usecases を直接参照。
    {
      code: `import { computeRoundTrips } from "@/server/usecases/compute-round-trips";`,
      filename: "/project/src/client/components/Foo.tsx",
      errors: [{ messageId: "noDirectServerImport" }],
    },
    // app から lib を直接参照。
    {
      code: `import { buildGraph } from "@/server/lib/osm/build-graph";`,
      filename: "/project/src/app/api/round-trip/route.ts",
      errors: [{ messageId: "noDirectServerImport" }],
    },
  ],
});
