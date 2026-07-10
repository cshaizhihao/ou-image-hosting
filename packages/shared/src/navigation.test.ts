import { describe, expect, it } from "vitest";
import { filterNavigationItems, navigationItems } from "./index";

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

  it("uses one permission filter for every navigation surface", () => {
    const viewer = filterNavigationItems({
      workspaceRole: "viewer",
      siteRole: "member"
    }).map((item) => item.key);
    expect(viewer).toContain("library");
    expect(viewer).not.toContain("upload");
    expect(viewer).not.toContain("team");
    expect(viewer).not.toContain("storage");

    const admin = filterNavigationItems({
      workspaceRole: "admin",
      siteRole: "member"
    }).map((item) => item.key);
    expect(admin).toEqual(
      expect.arrayContaining(["upload", "team", "tokens", "audit"])
    );
    expect(admin).not.toContain("storage");

    const siteOwner = filterNavigationItems({
      workspaceRole: "viewer",
      siteRole: "owner"
    }).map((item) => item.key);
    expect(siteOwner).toContain("storage");
  });
});
