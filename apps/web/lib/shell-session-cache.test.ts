import { beforeEach, describe, expect, it } from "vitest";
import type { SessionBootstrap } from "./api";
import {
  clearShellSessionSnapshot,
  readShellSessionSnapshot,
  switchShellSessionWorkspace,
  writeShellSessionSnapshot
} from "./shell-session-cache";

const bootstrap: SessionBootstrap = {
  user: {
    id: "user-owner",
    email: "owner@example.com",
    displayName: "Owner",
    role: "owner",
    theme: "light",
    onboardingCompleted: true,
    createdAt: "2026-07-11T00:00:00.000Z"
  },
  workspaces: [
    { id: "workspace-a", name: "A", role: "owner" },
    { id: "workspace-b", name: "B", role: "viewer" }
  ],
  defaultWorkspace: { id: "workspace-a", name: "A", role: "owner" },
  backoffice: {
    allowed: true,
    role: "owner",
    workspaceId: "workspace-a"
  }
};

describe("shell session snapshot", () => {
  beforeEach(() => clearShellSessionSnapshot());

  it("keeps the verified workspace role available across shell remounts", () => {
    writeShellSessionSnapshot(bootstrap, "workspace-a");

    expect(readShellSessionSnapshot()).toMatchObject({
      user: { role: "owner" },
      currentWorkspace: { id: "workspace-a", role: "owner" }
    });
  });

  it("updates the cached workspace without changing the verified user", () => {
    writeShellSessionSnapshot(bootstrap, "workspace-a");
    switchShellSessionWorkspace(bootstrap.workspaces[1]!);

    expect(readShellSessionSnapshot()).toMatchObject({
      user: { id: "user-owner" },
      currentWorkspace: { id: "workspace-b", role: "viewer" }
    });
  });

  it("clears cached navigation access after logout or session failure", () => {
    writeShellSessionSnapshot(bootstrap, "workspace-a");
    clearShellSessionSnapshot();

    expect(readShellSessionSnapshot()).toBeNull();
  });
});
