import "@/app/globals.css";

import type { Preview } from "@storybook/nextjs-vite";
import { useEffect } from "react";

/**
 * runon のテーマは <html data-theme="dark|light"> 1属性で CSS 変数を切り替える設計
 * （globals.css の @custom-variant dark）。Storybook では本番と同じ経路を再現するため、
 * ツールバーの選択値を story iframe の documentElement に反映する。
 */
const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  globalTypes: {
    theme: {
      description: "runon テーマ（data-theme）",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          {
            value: "dark",
            title: "Dark",
          },
          {
            value: "light",
            title: "Light",
          },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "dark",
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme as "dark" | "light";
      // story iframe の <html> にテーマを反映（本番の applyTheme と同じ属性）。
      useEffect(() => {
        document.documentElement.dataset.theme = theme;
      }, [theme]);
      return (
        <div className="min-h-[60vh] bg-bg p-6 text-fg">
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
