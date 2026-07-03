import { describe, expect, it } from "vitest";

import { isCallbackStateValid } from "@/server/handlers/strava-handler";

describe("isCallbackStateValid", () => {
  it("cookie と query の state が一致すれば true", () => {
    expect(isCallbackStateValid("abc-123", "abc-123")).toBe(true);
  });

  it("state が食い違えば false（CSRF）", () => {
    expect(isCallbackStateValid("abc-123", "evil-999")).toBe(false);
  });

  it("cookie が無ければ false（直リンク・期限切れ）", () => {
    expect(isCallbackStateValid(undefined, "abc-123")).toBe(false);
  });

  it("query に state が無ければ false", () => {
    expect(isCallbackStateValid("abc-123", null)).toBe(false);
  });

  it("両方が空文字でも false（空 state は発行しない）", () => {
    expect(isCallbackStateValid("", "")).toBe(false);
  });
});
