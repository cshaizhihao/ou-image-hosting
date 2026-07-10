import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ThemePreference = "light" | "dark" | "system";

export type SiteConfig = {
  siteName: string;
  registrationEnabled: boolean;
  defaultStorage: "local";
  theme: ThemePreference;
};

export type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: "owner" | "member";
  theme: ThemePreference;
  onboardingCompleted: boolean;
  failedLoginCount: number;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent?: string;
};

export type StoredPasswordReset = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

export type AppState = {
  schemaVersion: 1;
  setupComplete: boolean;
  site?: SiteConfig;
  users: StoredUser[];
  sessions: StoredSession[];
  passwordResets: StoredPasswordReset[];
};

const initialState = (): AppState => ({
  schemaVersion: 1,
  setupComplete: false,
  users: [],
  sessions: [],
  passwordResets: []
});

export class AppStore {
  private state: AppState = initialState();
  private queue = Promise.resolve();

  constructor(private readonly filePath: string | null) {}

  async initialize() {
    if (!this.filePath) return;
    try {
      const contents = await readFile(this.filePath, "utf8");
      this.state = JSON.parse(contents) as AppState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(this.state);
    }
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async update<T>(mutate: (draft: AppState) => T | Promise<T>) {
    let result!: T;
    const operation = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      result = await mutate(draft);
      this.state = draft;
      await this.persist(draft);
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async persist(state: AppState) {
    if (!this.filePath) return;
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.filePath);
  }
}
