/**
 * .message の文字列比較によるエラー種別の判定を禁止するルール。
 *
 * メッセージは変更・翻訳されうるため、制御フローの分岐条件にすると壊れやすく、
 * TypeScript も誤りを検出できない。AppError の .type で判定する。
 *
 * NG: if (result.error.message === "未設定") { ... }
 * OK: if (result.error.type === "config") { ... }
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: ".message の文字列比較によるエラー種別判定を禁止する（.type を使う）",
      recommended: true,
    },
    messages: {
      noMessageComparison:
        "エラー種別の判定に '.message' と文字列の比較を使わないでください。AppError に種別を足して '.type' で比較してください。",
    },
    schema: [],
  },

  create(context) {
    const isMessageAccess = (node) =>
      node.type === "MemberExpression" &&
      !node.computed &&
      node.property.type === "Identifier" &&
      node.property.name === "message";

    const isStringLiteral = (node) => node.type === "Literal" && typeof node.value === "string";

    return {
      BinaryExpression(node) {
        const { operator, left, right } = node;
        if (!["===", "!==", "==", "!="].includes(operator)) return;

        if (
          (isMessageAccess(left) && isStringLiteral(right)) ||
          (isStringLiteral(left) && isMessageAccess(right))
        ) {
          context.report({ node, messageId: "noMessageComparison" });
        }
      },
    };
  },
};
