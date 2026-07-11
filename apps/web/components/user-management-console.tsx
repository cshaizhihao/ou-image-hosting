"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Button, cn } from "@ou-image/ui";
import {
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  Search,
  ShieldCheck,
  UserRoundCheck,
  UserRoundX,
  Users,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { AppShell } from "./app-shell";
import styles from "./user-management.module.css";

type ManagedUser = {
  id: string;
  email: string;
  displayName: string;
  siteRole: "owner" | "member";
  backofficeRole: "owner" | "admin" | "member";
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

function readableTime(value?: string) {
  if (!value) return "尚未登录";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function requestMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function UserManagementConsole() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reset, setReset] = useState<{
    user: ManagedUser;
    url: string;
    expiresAt: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ users: ManagedUser[] }>("/site/users");
      setUsers(payload.users);
    } catch (requestError) {
      setError(requestMessage(requestError, "用户列表加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return users;
    return users.filter((user) =>
      `${user.displayName} ${user.email}`.toLowerCase().includes(normalized)
    );
  }, [query, users]);

  const changeRole = async (user: ManagedUser) => {
    const role = user.backofficeRole === "admin" ? "member" : "admin";
    setBusyId(user.id);
    setError("");
    try {
      await apiRequest(`/site/users/${encodeURIComponent(user.id)}/backoffice-role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      setNotice(
        role === "admin"
          ? `${user.displayName} 已成为子管理员，需要重新登录后生效。`
          : `${user.displayName} 的后台访问已撤销。`
      );
      await load();
    } catch (requestError) {
      setError(requestMessage(requestError, "角色更新失败"));
    } finally {
      setBusyId("");
    }
  };

  const changeStatus = async (user: ManagedUser) => {
    const disabled = user.status === "active";
    setBusyId(user.id);
    setError("");
    try {
      await apiRequest(`/site/users/${encodeURIComponent(user.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ disabled })
      });
      setNotice(
        disabled
          ? `${user.displayName} 已停用，现有登录会话已经撤销。`
          : `${user.displayName} 已恢复使用。`
      );
      await load();
    } catch (requestError) {
      setError(requestMessage(requestError, "账号状态更新失败"));
    } finally {
      setBusyId("");
    }
  };

  const issueReset = async (user: ManagedUser) => {
    setBusyId(user.id);
    setError("");
    try {
      const payload = await apiRequest<{ resetUrl: string; expiresAt: string }>(
        `/site/users/${encodeURIComponent(user.id)}/password-reset`,
        { method: "POST" }
      );
      setReset({ user, url: payload.resetUrl, expiresAt: payload.expiresAt });
    } catch (requestError) {
      setError(requestMessage(requestError, "密码重置链接创建失败"));
    } finally {
      setBusyId("");
    }
  };

  return (
    <AppShell activeKey="users">
      <main className={cn("workspace-page", styles.page)}>
        <header className={styles.header}>
          <div>
            <span>USERS &amp; ACCESS</span>
            <h1>用户与权限</h1>
            <p>注册用户默认只能使用公共图床；只有你手动授权的子管理员才能进入后台。</p>
          </div>
          <div className={styles.summary}>
            <Users aria-hidden="true" size={20} />
            <strong>{users.length}</strong>
            <span>个账号</span>
          </div>
        </header>

        <section className={styles.toolbar}>
          <label>
            <Search aria-hidden="true" size={18} />
            <input
              aria-label="搜索用户"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索昵称或邮箱"
              value={query}
            />
          </label>
          <Button disabled={loading} onClick={() => void load()} variant="secondary">
            {loading && <LoaderCircle className="spin" size={16} />}
            刷新
          </Button>
        </section>

        {(notice || error) && (
          <div className={cn(styles.message, error && styles.error)} role={error ? "alert" : "status"}>
            <span>{error || notice}</span>
            <button aria-label="关闭提示" onClick={() => { setError(""); setNotice(""); }} type="button">
              <X size={15} />
            </button>
          </div>
        )}

        <section className={styles.panel} aria-busy={loading}>
          {loading && users.length === 0 ? (
            <div className={styles.empty}><LoaderCircle className="spin" size={26} /><strong>正在读取用户</strong></div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}><Users size={28} /><strong>没有符合条件的账号</strong><span>换个昵称或邮箱关键词试试。</span></div>
          ) : (
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>账号</th><th>身份</th><th>状态</th><th>最近登录</th><th><span className="sr-only">操作</span></th></tr></thead>
                <tbody>
                  {filtered.map((user) => {
                    const immutable = user.siteRole === "owner";
                    const busy = busyId === user.id;
                    return (
                      <tr key={user.id}>
                        <td><div className={styles.identity}><span>{user.displayName.slice(0, 2).toUpperCase()}</span><div><strong>{user.displayName}</strong><small>{user.email}</small></div></div></td>
                        <td><span className={cn(styles.role, styles[`role_${user.backofficeRole}`])}>{user.backofficeRole === "owner" ? "站点所有者" : user.backofficeRole === "admin" ? "子管理员" : "注册用户"}</span></td>
                        <td><span className={cn(styles.status, user.status === "disabled" && styles.disabled)}>{user.status === "active" ? "正常" : "已停用"}</span></td>
                        <td><time dateTime={user.lastLoginAt}>{readableTime(user.lastLoginAt)}</time></td>
                        <td>
                          {immutable ? <span className={styles.ownerNote}><ShieldCheck size={15} />唯一所有者</span> : (
                            <div className={styles.actions}>
                              <Button disabled={busy || user.status === "disabled"} onClick={() => void changeRole(user)} size="compact" variant="secondary">
                                {user.backofficeRole === "admin" ? <UserRoundX size={15} /> : <UserRoundCheck size={15} />}
                                {user.backofficeRole === "admin" ? "撤销后台" : "设为子管理员"}
                              </Button>
                              <Button disabled={busy} onClick={() => void issueReset(user)} size="compact" variant="ghost"><KeyRound size={15} />重置密码</Button>
                              <Button disabled={busy} onClick={() => void changeStatus(user)} size="compact" variant="ghost">{user.status === "active" ? "停用" : "启用"}</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Dialog.Root open={Boolean(reset)} onOpenChange={(open) => { if (!open) setReset(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content aria-describedby="reset-description" className={styles.dialog}>
              <div className={styles.dialogIcon}><KeyRound size={21} /></div>
              <Dialog.Title>密码重置链接已创建</Dialog.Title>
              <Dialog.Description id="reset-description">链接仅在这里显示一次，30 分钟内有效。发送给 {reset?.user.displayName} 后，让对方自行设置新密码。</Dialog.Description>
              <code>{reset?.url}</code>
              <Button onClick={() => { if (reset) void navigator.clipboard.writeText(reset.url).then(() => setNotice("重置链接已复制。")); }}><Clipboard size={16} />复制重置链接</Button>
              <Dialog.Close asChild><Button variant="secondary"><Check size={16} />完成</Button></Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </main>
    </AppShell>
  );
}
