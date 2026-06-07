import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-direct-layer-import", rule, {
  valid: [
    // app → handlers は許可。
    {
      code: `import { roundTripHandler } from "@/server/handlers/round-trip-handler";`,
      filename: "/project/src/app/api/round-trip/route.ts",
    },
    // usecases → repositories/lib は許可（repositories ファイルではないので対象外）。
    {
      code: `import { overpassRepository } from "@/server/repositories/overpass-repository";`,
      filename: "/project/src/server/usecases/compute-round-trips.ts",
    },
    // repositories → lib は許可（repositories から usecases でなければOK）。
    {
      code: `import { buildGraph } from "@/server/lib/osm/build-graph";`,
      filename: "/project/src/server/repositories/overpass-repository.ts",
    },
  ],
  invalid: [
    // app → repositories（usecases を飛ばす）。
    {
      code: `import { overpassRepository } from "@/server/repositories/overpass-repository";`,
      filename: "/project/src/app/api/round-trip/route.ts",
      errors: [{ messageId: "noDirectLayerImport" }],
    },
    // app → lib（usecases を飛ばす）。
    {
      code: `import { buildGraph } from "@/server/lib/osm/build-graph";`,
      filename: "/project/src/app/page.tsx",
      errors: [{ messageId: "noDirectLayerImport" }],
    },
    // repositories → usecases（依存方向の逆転）。
    {
      code: `import { computeRoundTrips } from "@/server/usecases/compute-round-trips";`,
      filename: "/project/src/server/repositories/overpass-repository.ts",
      errors: [{ messageId: "noReverseLayerImport" }],
    },
  ],
});
