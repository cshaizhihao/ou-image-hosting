import { PublicError } from "./errors.js";

export class MaintenanceGate {
  private restoring = false;
  private backingUp = false;
  private activeWrites = 0;
  private drainWaiters: Array<() => void> = [];

  get restoreInProgress() {
    return this.restoring;
  }

  get backupInProgress() {
    return this.backingUp;
  }

  beginWrite() {
    if (this.restoring) {
      throw new PublicError(
        503,
        "RESTORE_MAINTENANCE",
        "系统正在恢复备份，暂时无法执行写操作"
      );
    }
    if (this.backingUp) {
      throw new PublicError(
        503,
        "BACKUP_MAINTENANCE",
        "系统正在创建一致性备份，暂时无法执行写操作"
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
    if (this.backingUp) {
      throw new PublicError(
        503,
        "BACKUP_MAINTENANCE",
        "系统正在创建一致性备份，请等待备份完成"
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

  async beginBackup() {
    if (this.restoring) {
      throw new PublicError(
        503,
        "RESTORE_MAINTENANCE",
        "系统正在恢复备份，请等待恢复完成"
      );
    }
    if (this.backingUp) {
      throw new PublicError(
        409,
        "BACKUP_IN_PROGRESS",
        "已有备份任务正在执行"
      );
    }
    this.backingUp = true;
    if (this.activeWrites > 0) {
      await new Promise<void>((resolve) => {
        this.drainWaiters.push(resolve);
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.backingUp = false;
    };
  }
}
