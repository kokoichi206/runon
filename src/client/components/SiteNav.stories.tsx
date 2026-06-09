import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { SiteNav } from "@/client/components/SiteNav";

/**
 * 全ページ共通ヘッダー。現在パスのリンクをハイライトする。
 * usePathname は nextjs-vite framework の router モックで供給する
 * （parameters.nextjs.navigation.pathname）。
 */
const meta = {
  title: "components/SiteNav",
  component: SiteNav,
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/" },
    },
  },
} satisfies Meta<typeof SiteNav>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * 周回路（トップ）がアクティブ。
 */
export const Home: Story = {};

/**
 * トレーニングページがアクティブ。
 */
export const Training: Story = {
  parameters: {
    nextjs: { navigation: { pathname: "/training" } },
  },
};
