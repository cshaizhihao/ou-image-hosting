import { describe, expect, it } from "vitest";
import type { SessionBootstrap } from "./api";
import {
  formatOverviewBytes,
  overviewQuotaPercent,
  overviewRoleLabel,
  selectOverviewWorkspace
} from "./overview-model";

const bootstrap: SessionBootstrap = {
  user: {
    id: "user",
    email: "owner@example.com",
    displayName: "Owner",
    role: "owner",
    theme: "light",
    onboardingCompleted: true,
    createdAt: "2026-07-11T00:00:00.000Z"
  },
  workspaces: [
    { id: "a", name: "主工作区", role: "owner" },
    { id: "b", name: "共享工作区", role: "viewer" }
  ],
  defaultWorkspace: { id: "a", name: "主工作区", role: "owner" }
};

describe("overview model", () => {
  it("selects the active workspace and falls back safely", () => {
    expect(selectOverviewWorkspace(bootstrap, "b").id).toBe("b");
    expect(selectOverviewWorkspace(bootstrap, "missing").id).toBe("a");
  });

  it("formats real quota data without exceeding the progress range", () => {
    expect(
      overviewQuotaPercent({ count: 1, bytes: 75, quotaBytes: 100 })
    ).toBe(75);
    expect(
      overviewQuotaPercent({ count: 1, bytes: 150, quotaBytes: 100 })
    ).toBe(100);
    expect(
      overviewQuotaPercent({ count: 0, bytes: 0, quotaBytes: 0 })
    ).toBe(0);
  });

  it("provides readable role and storage labels", () => {
    expect(overviewRoleLabel(bootstrap.workspaces[0]!)).toBe("所有者");
    expect(formatOverviewBytes(1536)).toBe("1.5 KB");
  });
});
