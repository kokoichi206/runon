/**
 * API route handler（src/app/api 配下の route.ts）の行数上限を強制するルール。
 *
 * route は薄く保ち、ロジックは src/server/ 側（handlers/usecases/lib）へ寄せる。
 * 空行・コメント行は数えない。
 *
 * オプション: maxLines（既定 80）
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "API route handler を薄く保つため行数上限を強制する",
      recommended: true,
    },
    messages: {
      tooManyLines:
        "API route handler が {{count}} 行あります（上限 {{max}}）。ロジックを @/server/handlers や @/server/usecases へ抽出してください。",
    },
    schema: [
      {
        type: "object",
        properties: {
          maxLines: {
            type: "integer",
            minimum: 1,
            default: 80,
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const filename = (context.filename || context.getFilename()).replace(/\\/g, "/");
    const isApiRoute = filename.includes("/src/app/api/") && filename.endsWith("/route.ts");
    if (!isApiRoute) return {};

    const maxLines = context.options[0]?.maxLines ?? 80;

    return {
      "Program:exit"(node) {
        const sourceCode = context.sourceCode || context.getSourceCode();
        let count = 0;
        let inBlockComment = false;

        for (const line of sourceCode.lines) {
          const trimmed = line.trim();
          if (trimmed.includes("/*")) inBlockComment = true;
          if (inBlockComment) {
            if (trimmed.includes("*/")) inBlockComment = false;
            continue;
          }
          if (trimmed === "" || trimmed.startsWith("//")) continue;
          count++;
        }

        if (count > maxLines) {
          context.report({
            node,
            messageId: "tooManyLines",
            data: {
              count,
              max: maxLines,
            },
            loc: {
              line: 1,
              column: 0,
            },
          });
        }
      },
    };
  },
};
