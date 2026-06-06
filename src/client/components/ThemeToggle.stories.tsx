import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ThemeToggle } from "@/client/components/ThemeToggle";

/**
 * テーマ切替 UI。選択は localStorage に保存され、<html data-theme> を書き換える。
 * preview.tsx の Theme ツールバーとは別系統だが、押下すると同じ data-theme を操作する。
 */
const meta = {
  title: "components/ThemeToggle",
  component: ThemeToggle,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ThemeToggle>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
