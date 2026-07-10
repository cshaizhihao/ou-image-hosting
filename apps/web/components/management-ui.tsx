"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Badge, Button, cn } from "@ou-image/ui";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  LoaderCircle,
  ShieldX,
  X,
  type LucideIcon
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { MemberRole } from "@/lib/admin-api";
import { AppShell } from "./app-shell";
import styles from "./management.module.css";

export { styles as managementStyles };

export const memberRoleCopy: Record<MemberRole, string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "只读成员"
};

export function formatManagementDate(value?: string, fallback = "从未") {
  if (!value) return fallback;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function requestMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function ManagementPage({
  activeKey,
  children
}: {
  activeKey: string;
  children: ReactNode;
}) {
  return (
    <AppShell activeKey={activeKey}>
      <main className={cn("workspace-page", styles.page)}>{children}</main>
    </AppShell>
  );
}

export function ManagementHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className={styles.headerAction}>{action}</div>}
    </header>
  );
}

export function ManagementNotice({
  tone,
  children,
  onClose
}: {
  tone: "success" | "error";
  children: ReactNode;
  onClose: () => void;
}) {
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div
      aria-live="polite"
      className={cn(styles.notice, styles[`notice_${tone}`])}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" size={17} />
      <span>{children}</span>
      <button aria-label="关闭提示" onClick={onClose} type="button">
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

export function ManagementTabs<T extends string>({
  active,
  items,
  onChange
}: {
  active: T;
  items: Array<{ id: T; label: string; icon: LucideIcon; count?: number }>;
  onChange: (id: T) => void;
}) {
  return (
    <div aria-label="页面分区" className={styles.tabs} role="tablist">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            aria-selected={active === item.id}
            className={cn(active === item.id && styles.tabActive)}
            key={item.id}
            onClick={() => onChange(item.id)}
            role="tab"
            type="button"
          >
            <Icon aria-hidden="true" size={16} />
            <span>{item.label}</span>
            {item.count !== undefined && <small>{item.count}</small>}
          </button>
        );
      })}
    </div>
  );
}

export function LoadingPanel({ label = "正在读取数据" }: { label?: string }) {
  return (
    <div aria-live="polite" className={styles.loading} role="status">
      <LoaderCircle aria-hidden="true" size={24} />
      <strong>{label}</strong>
      <span>请稍候，页面会自动更新。</span>
    </div>
  );
}

export function EmptyPanel({
  icon: Icon,
  title,
  description,
  action
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span>
        <Icon aria-hidden="true" size={24} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function AccessDenied() {
  return (
    <EmptyPanel
      description="当前工作区角色没有访问此模块的权限。切换工作区或联系工作区所有者。"
      icon={ShieldX}
      title="权限不足"
    />
  );
}

export function RoleBadge({ role }: { role: MemberRole }) {
  const tone = role === "owner" ? "warning" : role === "admin" ? "info" : "neutral";
  return <Badge tone={tone}>{memberRoleCopy[role]}</Badge>;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  icon: Icon,
  title,
  description,
  confirmLabel,
  busy,
  danger,
  children,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
        <Dialog.Content className={styles.dialog}>
          <div className={cn(styles.dialogIcon, danger && styles.dialogIconDanger)}>
            <Icon aria-hidden="true" size={21} />
          </div>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          {children}
          <div className={styles.dialogActions}>
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              variant="secondary"
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={onConfirm}
              variant={danger ? "danger" : "primary"}
            >
              {busy && <LoaderCircle className={styles.spin} size={16} />}
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function OneTimeSecretDialog({
  open,
  onOpenChange,
  title,
  description,
  secret,
  label = "一次性密钥"
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  secret: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const close = (nextOpen: boolean) => {
    if (!nextOpen) setCopied(false);
    onOpenChange(nextOpen);
  };
  return (
    <Dialog.Root onOpenChange={close} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
        <Dialog.Content className={cn(styles.dialog, styles.secretDialog)}>
          <div className={styles.secretMark}>1×</div>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
          <div className={styles.secretBox}>
            <span>{label}</span>
            <code>{secret}</code>
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(secret);
                setCopied(true);
              }}
              size="compact"
              variant="secondary"
            >
              {copied ? (
                <CheckCircle2 aria-hidden="true" size={15} />
              ) : (
                <Copy aria-hidden="true" size={15} />
              )}
              {copied ? "已复制" : "复制"}
            </Button>
          </div>
          <div className={styles.secretWarning}>
            关闭后将从页面状态中清除，无法再次查看。
          </div>
          <div className={styles.dialogActions}>
            <Button onClick={() => close(false)}>我已安全保存</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
