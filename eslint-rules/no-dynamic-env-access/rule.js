/**
 * process.env への動的アクセス（process.env[expr]）を禁止するルール。
 *
 * 動的アクセスは型チェックを回避し、出処を不明にする。
 * 環境変数は @/shared/env の serverEnv 経由で静的に参照する。
 *
 * NG: process.env[key]
 * OK: serverEnv.SITE_URL
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "process.env への動的アクセスを禁止する",
      recommended: true,
    },
    messages: {
      noDynamicEnvAccess:
        "process.env への動的アクセスは禁止です。@/shared/env の serverEnv から静的に参照してください。",
    },
    schema: [],
  },

  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.computed === true &&
          node.object.type === "MemberExpression" &&
          node.object.object.type === "Identifier" &&
          node.object.object.name === "process" &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "env"
        ) {
          context.report({ node, messageId: "noDynamicEnvAccess" });
        }
      },
    };
  },
};
