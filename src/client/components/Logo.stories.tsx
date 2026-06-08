import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Logo, LogoMark } from "@/client/components/Logo";

const meta = {
  title: "components/Logo",
  component: Logo,
  parameters: { layout: "centered" },
  argTypes: {
    size: { control: { type: "range", min: 16, max: 96, step: 2 } },
  },
  args: { size: 28 },
} satisfies Meta<typeof Logo>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * マーク + ワードマーク（sm 以上でワードマーク表示）。
 */
export const Default: Story = {};

export const Large: Story = {
  args: { size: 64 },
};

/**
 * マーク単体（アクセント色のグラデーション + グロー）。
 */
export const MarkOnly: StoryObj<typeof LogoMark> = {
  render: (args) => <LogoMark {...args} />,
  args: { size: 48 },
};
