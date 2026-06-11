/**
 * 1行で書かれたブロックコメント（/** ... *\/ や /* ... *\/）を禁止し、
 * 複数行のスター付きブロックコメントへの展開を強制する ESLint ルール。
 *
 * 禁止パターン（行頭に独立して書かれた1行ブロックコメント）:
 * - /** ユーザーを取得する *\/
 * - /* ユーザーを取得する *\/
 *
 * 展開後:
 * - /**
 *    * ユーザーを取得する
 *    *\/
 *
 * 除外対象（報告しない）:
 * - eslint / ts / prettier 等のディレクティブコメント
 * - 同一行にコードが存在する行中インラインコメント（例: foo(/* x *\/ y)）
 * - 中身が空のコメント
 */

// ディレクティブコメントは構文上の意味を持つため展開すると壊れる。先頭一致で除外する。
const DIRECTIVE_PREFIXES = [
  "eslint-disable",
  "eslint-enable",
  "eslint-disable-line",
  "eslint-disable-next-line",
  "eslint",
  "global",
  "globals",
  "exported",
  "prettier-ignore",
  "@ts-",
  "@jsx",
  "@flow",
  "c8 ",
  "v8 ",
  "istanbul ",
  "webpackChunkName",
  "@vite-ignore",
  "@__PURE__",
  "#__PURE__",
  "@preserve",
  "@license",
  "biome-ignore",
];

const isDirective = (text) => {
  const trimmed = text.trimStart();
  return DIRECTIVE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
};

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "layout",
    docs: {
      description:
        "1行で書かれたブロックコメントを禁止し、複数行のスター付きブロックコメントへ展開する",
      recommended: true,
    },
    fixable: "code",
    messages: {
      singleLineBlockComment:
        "1行のブロックコメントは使用しないでください。複数行のブロックコメント、または // 行コメントに置き換えてください。",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          if (comment.type !== "Block") continue;
          // 複数行のブロックコメントは対象外（既に展開済み）。
          if (comment.loc.start.line !== comment.loc.end.line) continue;
          if (isDirective(comment.value)) continue;

          const isJsdoc = comment.value.startsWith("*");
          const inner = (isJsdoc ? comment.value.replace(/^\*/, "") : comment.value).trim();
          // 中身が空のコメントは展開しても意味がないため対象外。
          if (inner === "") continue;

          // 同一行にコードがあるインラインコメントは展開すると構文が壊れるため対象外。
          const before = sourceCode.getTokenBefore(comment, {
            includeComments: true,
          });
          const after = sourceCode.getTokenAfter(comment, {
            includeComments: true,
          });
          const hasCodeBefore = before && before.loc.end.line === comment.loc.start.line;
          const hasCodeAfter = after && after.loc.start.line === comment.loc.end.line;
          if (hasCodeBefore || hasCodeAfter) continue;

          const indent = " ".repeat(comment.loc.start.column);
          const open = isJsdoc ? "/**" : "/*";
          const replacement = `${open}\n${indent} * ${inner}\n${indent} */`;

          context.report({
            loc: comment.loc,
            messageId: "singleLineBlockComment",
            fix(fixer) {
              return fixer.replaceTextRange(comment.range, replacement);
            },
          });
        }
      },
    };
  },
};
