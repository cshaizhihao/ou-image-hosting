import { PublicError } from "./errors.js";

export class MaintenanceGate {
  private restoring = false;
  private activeWrites = 0;
  private drainWaiters: Array<() => void> = [];

  get restoreInProgress() {
    return this.restoring;
  }

  beginWrite() {
    if (this.restoring) {
      throw new PublicError(
        503,
        "RESTORE_MAINTENANCE",
        "系统正在恢复备份，暂时无法执行写操作"
      );
    }
    this.activeWrites += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeWrites = Math.max(0, this.activeWrites - 1);
      if (this.activeWrites === 0) {
        const waiters = this.drainWaiters;
        this.drainWaiters = [];
        waiters.forEach((resolve) => resolve());
      }
    };
  }

  async beginRestore() {
    if (this.restoring) {
      throw new PublicError(
        503,
        "RESTORE_MAINTENANCE",
        "系统正在恢复备份，请等待当前恢复完成"
      );
    }
    this.restoring = true;
    if (this.activeWrites > 0) {
      await new Promise<void>((resolve) => {
        this.drainWaiters.push(resolve);
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.restoring = false;
    };
  }
}
