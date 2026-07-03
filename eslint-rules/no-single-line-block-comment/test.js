import { RuleTester } from "eslint";

import rule from "./rule.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("no-single-line-block-comment", rule, {
  valid: [
    // 行コメントは対象外。
    {
      code: `// ユーザーを取得する\nconst getUser = () => {};`,
    },
    // 複数行ブロックコメントは対象外（既に展開済み）。
    {
      code: `/**\n * ユーザーを取得する\n */\nconst getUser = () => {};`,
    },
    // eslint ディレクティブは除外。
    {
      code: `/* eslint-disable no-console */\nconst a = 1;`,
    },
    {
      code: `/* global window */\nconst a = 1;`,
    },
    // ts ディレクティブは除外。
    {
      code: `/* @ts-expect-error これは意図的 */\nconst a = 1;`,
    },
    // 行中インラインコメント（前後にコード）は除外。
    {
      code: `const a = fn(/* x */ 1);`,
    },
    // 行末トレーリングコメントは除外。
    {
      code: `const a = 1; /* メモ */`,
    },
    // 中身が空のコメントは対象外。
    {
      code: `/** */\nconst a = 1;`,
    },
    {
      code: `/*  */\nconst a = 1;`,
    },
  ],

  invalid: [
    // 独立行の JSDoc 1行コメント → 複数行 JSDoc へ展開。
    {
      code: `/** ユーザーを取得する */\nconst getUser = () => {};`,
      output: `/**\n * ユーザーを取得する\n */\nconst getUser = () => {};`,
      errors: [{
        messageId: "singleLineBlockComment",
      }],
    },
    // 独立行のプレーン 1行ブロックコメント → 複数行ブロックへ展開（/* を維持）。
    {
      code: `/* 合計を計算する */\nconst total = 0;`,
      output: `/*\n * 合計を計算する\n */\nconst total = 0;`,
      errors: [{
        messageId: "singleLineBlockComment",
      }],
    },
    // インデントを保持して展開。
    {
      code: `const f = () => {\n  /** 内部処理 */\n  return 1;\n};`,
      output: `const f = () => {\n  /**\n   * 内部処理\n   */\n  return 1;\n};`,
      errors: [{
        messageId: "singleLineBlockComment",
      }],
    },
  ],
});
