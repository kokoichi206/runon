import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const dirname = fileURLToPath(new URL(".", import.meta.url));

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    projects: [
      // 既存のロジック系ユニットテスト + カスタム ESLint ルールのテスト（node 環境）。
      // ESLint の RuleTester は global の describe/it を使うため globals を有効化する。
      {
        resolve: {
          alias,
        },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "eslint-rules/**/test.js"],
          environment: "node",
          globals: true,
        },
      },
      // Storybook の story を browser(playwright) でテスト実行する。
      {
        resolve: {
          alias,
        },
        plugins: [storybookTest({
          configDir: `${dirname}.storybook`,
        })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{
              browser: "chromium",
            }],
          },
        },
      },
    ],
  },
});
