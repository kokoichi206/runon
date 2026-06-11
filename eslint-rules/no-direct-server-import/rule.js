/**
 * src/server/ の外からの @/server/* 直接 import を禁止するルール（@/server/handlers/* のみ許可）。
 *
 * server ロジックを src/server/ 内に閉じ込め、外部（app/client）からは handlers 経由でのみ
 * アクセスさせる。純粋ドメインロジックでブラウザからも使うものは @/shared/ に置く。
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "src/server/ 外からの @/server/*（handlers 以外）の import を禁止する",
      recommended: true,
    },
    messages: {
      noDirectServerImport:
        "'{{importPath}}' を直接 import しないでください。@/server/handlers/* 経由にするか、" +
        "ブラウザからも使う純粋ロジックなら @/shared/ へ移してください。",
    },
    schema: [],
  },

  create(context) {
    const filename = (context.filename || context.getFilename()).replace(/\\/g, "/");

    // src/server/ 内のファイルは対象外。
    if (/\/src\/server\//.test(filename)) return {};

    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;
        if (typeof importPath !== "string") return;
        if (!importPath.startsWith("@/server/")) return;
        if (importPath.startsWith("@/server/handlers")) return;

        context.report({
          node: node.source,
          messageId: "noDirectServerImport",
          data: {
            importPath,
          },
        });
      },
    };
  },
};
