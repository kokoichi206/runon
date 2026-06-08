/**
 * server コードでの throw を禁止し、Result 型でのエラー処理を強制するルール。
 *
 * throw は制御フローを暗黙化し、呼び出し側に分岐を型で強制できない。
 * 代わりに @/shared/result の ok()/err() を返す。
 *
 * NG: throw new Error("...");
 * OK: return err(appError.internal("..."));
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "server コードでの throw を禁止し Result 型の使用を強制する",
      recommended: true,
    },
    messages: {
      noThrowStatement:
        "server コードで 'throw' を使わないでください。エラーは @/shared/result の err() を返して表現します。",
    },
    schema: [],
  },

  create(context) {
    return {
      ThrowStatement(node) {
        context.report({ node, messageId: "noThrowStatement" });
      },
    };
  },
};
