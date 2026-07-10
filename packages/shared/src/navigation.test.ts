import { describe, expect, it } from "vitest";
import { navigationItems } from "./index";

describe("navigationItems", () => {
  it("keeps unique keys and routes", () => {
    expect(new Set(navigationItems.map((item) => item.key)).size).toBe(
      navigationItems.length
    );
    expect(new Set(navigationItems.map((item) => item.href)).size).toBe(
      navigationItems.length
    );
  });

  it("keeps the mobile primary destinations available", () => {
    expect(navigationItems.map((item) => item.key)).toEqual(
      expect.arrayContaining(["overview", "library", "upload", "albums", "settings"])
    );
  });
});
