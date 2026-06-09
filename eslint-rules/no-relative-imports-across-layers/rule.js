/**
 * レイヤーをまたぐ相対 import（../）を禁止するルール。
 *
 * 層をまたぐ参照は絶対パス（@/*）に統一し、移動に強くする。同一層内の相対 import は許可。
 * shared / types はどこからでも参照可。
 *
 * NG: import { foo } from "../../server/usecases/foo"; // app から
 * OK: import { foo } from "@/server/handlers/foo";
 */

const detectLayer = (filepath) => {
  if (filepath.includes("/src/app/")) return "app";
  if (filepath.includes("/src/client/")) return "client";
  if (filepath.includes("/src/server/")) return "server";
  if (filepath.includes("/src/shared/")) return "shared";
  return null;
};

const detectLayerFromImportPath = (importPath) => {
  for (const segment of importPath.split("/")) {
    if (segment === "app") return "app";
    if (segment === "client") return "client";
    if (segment === "server") return "server";
    if (segment === "shared") return "shared";
  }
  return null;
};

const isLayerCrossing = (fromLayer, toLayer) => {
  if (fromLayer === toLayer) return false;
  // shared はどこからでも参照可。
  if (toLayer === "shared") return false;
  // app/client → server は handlers 経由にすべき。
  if ((fromLayer === "app" || fromLayer === "client") && toLayer === "server") return true;
  // app ↔ client の相互参照は不可。
  if (
    (fromLayer === "app" && toLayer === "client") ||
    (fromLayer === "client" && toLayer === "app")
  ) {
    return true;
  }
  return false;
};

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "レイヤーをまたぐ相対 import を禁止する（@/* を使う）",
      recommended: true,
    },
    messages: {
      noRelativeImportAcrossLayers:
        "層をまたぐ相対 import は禁止です（'{{fromLayer}}' → '{{toLayer}}'）。@/* の絶対パスを使ってください。",
    },
    schema: [],
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        const importSource = node.source.value;
        if (typeof importSource !== "string" || !importSource.startsWith("../")) return;

        const filename = (context.filename || context.getFilename()).replace(/\\/g, "/");
        const fromLayer = detectLayer(filename);
        if (!fromLayer) return;

        const toLayer = detectLayerFromImportPath(importSource);
        if (!toLayer) return;

        if (isLayerCrossing(fromLayer, toLayer)) {
          context.report({
            node: node.source,
            messageId: "noRelativeImportAcrossLayers",
            data: { fromLayer, toLayer },
          });
        }
      },
    };
  },
};
