/**
 * レイヤーアーキテクチャの依存方向を強制するルール。
 *
 * 依存方向: app → handlers → usecases → repositories/lib（shared は leaf）
 *
 * 下方向の飛ばし違反:
 * - src/app/** が @/server/repositories/* や @/server/lib/* を直接 import
 * 逆方向の違反:
 * - src/server/repositories/** が @/server/usecases/* を import
 */

const DOWNWARD = [/^@\/server\/repositories(\/|$)/, /^@\/server\/lib(\/|$)/];
const UPWARD = [/^@\/server\/usecases(\/|$)/];

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "usecases を経由しない repositories/lib への直接 import を禁止する",
      recommended: true,
    },
    messages: {
      noDirectLayerImport:
        "'{{importPath}}' を直接 import しないでください。@/server/usecases 経由にして層構造を保ってください。",
      noReverseLayerImport:
        "repositories/ から '{{importPath}}' を import しないでください。依存方向（usecases → repositories）が逆転します。共有定数は @/shared/ へ。",
    },
    schema: [],
  },

  create(context) {
    const filename = (context.filename || context.getFilename()).replace(/\\/g, "/");
    const isInApp = /\/src\/app\//.test(filename);
    const isInRepositories = /\/src\/server\/repositories\//.test(filename);

    if (!isInApp && !isInRepositories) return {};

    return {
      ImportDeclaration(node) {
        const importPath = node.source.value;
        if (typeof importPath !== "string") return;

        if (isInApp && DOWNWARD.some((p) => p.test(importPath))) {
          context.report({
            node: node.source,
            messageId: "noDirectLayerImport",
            data: { importPath },
          });
        }
        if (isInRepositories && UPWARD.some((p) => p.test(importPath))) {
          context.report({
            node: node.source,
            messageId: "noReverseLayerImport",
            data: { importPath },
          });
        }
      },
    };
  },
};
