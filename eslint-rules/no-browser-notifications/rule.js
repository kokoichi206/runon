/**
 * ブラウザ標準の alert / confirm / prompt を禁止するルール。
 *
 * これらは UI を阻害し、見た目も OS 依存になる。アプリ独自の UI（トースト/確認ダイアログ）に
 * 統一する。window.* / globalThis.* 経由の呼び出しも検出する。
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "ブラウザ標準の alert / confirm / prompt を禁止する",
      recommended: true,
    },
    messages: {
      noBrowserNotification:
        "'{{name}}()' は使わないでください。アプリ独自のトースト/確認ダイアログ UI を使ってください。",
    },
    schema: [],
  },

  create(context) {
    const prohibited = new Set(["alert", "confirm", "prompt"]);

    return {
      CallExpression(node) {
        let name = null;

        // 直接呼び出し: alert() / confirm() / prompt()
        if (node.callee.type === "Identifier") {
          name = node.callee.name;
        }

        // window.alert() / globalThis.confirm() など
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          (node.callee.object.name === "window" || node.callee.object.name === "globalThis")
        ) {
          if (node.callee.property.type === "Identifier") {
            name = node.callee.property.name;
          } else if (node.callee.computed && node.callee.property.type === "Literal") {
            name = node.callee.property.value;
          }
        }

        if (typeof name === "string" && prohibited.has(name)) {
          context.report({
            node: node.callee,
            messageId: "noBrowserNotification",
            data: {
              name,
            },
          });
        }
      },
    };
  },
};
