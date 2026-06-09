/**
 * toLocaleString() の使用を禁止し Intl.* の利用を促すルール。
 *
 * toLocaleString() は Node.js の small-ICU ビルドで桁区切りが無い等、環境依存の
 * 動作をするため SSR で安全でない。Intl.NumberFormat / Intl.DateTimeFormat を使う。
 *
 * NG: value.toLocaleString("ja-JP")
 * OK: new Intl.NumberFormat("ja-JP").format(value)
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "toLocaleString() を禁止し Intl.NumberFormat / Intl.DateTimeFormat を促す",
      recommended: true,
    },
    messages: {
      noToLocaleString:
        "toLocaleString() は環境依存（small-ICU）で安全でないため使わないでください。" +
        '数値は new Intl.NumberFormat("ja-JP").format(value)、日付は Intl.DateTimeFormat を使ってください。',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "toLocaleString"
        ) {
          context.report({ node, messageId: "noToLocaleString" });
        }
      },
    };
  },
};
