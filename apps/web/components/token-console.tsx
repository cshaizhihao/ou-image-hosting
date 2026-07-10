"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Badge, Button, cn } from "@ou-image/ui";
import {
  CalendarClock,
  Check,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createToken,
  getTokens,
  revokeToken,
  type ApiTokenRecord
} from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import {
  AccessDenied,
  ConfirmActionDialog,
  EmptyPanel,
  LoadingPanel,
  ManagementHeader,
  ManagementNotice,
  ManagementPage,
  OneTimeSecretDialog,
  formatManagementDate,
  managementStyles as styles,
  requestMessage
} from "./management-ui";

const scopeOptions = [
  {
    id: "images:read",
    label: "读取图片",
    description: "读取工作区内的图片内容与图片元数据"
  },
  {
    id: "images:write",
    label: "写入图片",
    description: "上传图片，并编辑图片内容与元数据"
  },
  {
    id: "images:delete",
    label: "删除图片",
    description: "将图片移入回收站或永久删除图片"
  },
  {
    id: "organization:read",
    label: "读取内容组织",
    description: "读取相册、标签、收藏与图片归类信息"
  },
  {
    id: "organization:write",
    label: "管理内容组织",
    description: "创建和调整相册、标签、收藏与图片归类"
  },
  {
    id: "shares:read",
    label: "读取分享",
    description: "读取分享链接、访问策略与有效期"
  },
  {
    id: "shares:write",
    label: "管理分享",
    description: "创建、更新和撤销公开分享"
  },
  {
    id: "analytics:read",
    label: "读取统计",
    description: "读取访问量和存储趋势"
  }
] as const;

function tokenStatus(token: ApiTokenRecord) {
  if (token.status === "active") return <Badge tone="success">有效</Badge>;
  if (token.status === "expired") return <Badge tone="warning">已过期</Badge>;
  return <Badge>已撤销</Badge>;
}

export function TokenConsole() {
  const [tokens, setTokens] = useState<ApiTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["images:read"]);
  const [expiry, setExpiry] = useState("30");
  const [ipAllowlistText, setIpAllowlistText] = useState("");
  const [oneTimeToken, setOneTimeToken] = useState("");
  const [pendingRevoke, setPendingRevoke] =
    useState<ApiTokenRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setTokens(await getTokens());
      setDenied(false);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 403) {
        setDenied(true);
      } else {
        setError(requestMessage(requestError, "API Token 加载失败"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(
    () => tokens.filter((token) => token.status === "active").length,
    [tokens]
  );
  const usedCount = useMemo(
    () => tokens.filter((token) => Boolean(token.lastUsedAt)).length,
    [tokens]
  );
  const ipAllowlist = useMemo(
    () =>
      ipAllowlistText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    [ipAllowlistText]
  );

  const toggleScope = (scope: string) => {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope]
    );
  };

  const submitCreate = async () => {
    if (!name.trim() || scopes.length === 0) return;
    if (ipAllowlist.length > 20) {
      setError("IP/CIDR 白名单最多允许 20 项。");
      return;
    }
    setBusy("create");
    setError("");
    try {
      const days = Number(expiry);
      const payload = await createToken({
        name: name.trim(),
        scopes,
        expiresInDays: days > 0 ? days : undefined,
        ipAllowlist: ipAllowlist.length ? ipAllowlist : undefined
      });
      setTokens((current) => [payload.token, ...current]);
      setCreateOpen(false);
      setName("");
      setScopes(["images:read"]);
      setExpiry("30");
      setIpAllowlistText("");
      setOneTimeToken(payload.secret);
    } catch (requestError) {
      setError(requestMessage(requestError, "Token 创建失败"));
    } finally {
      setBusy("");
    }
  };

  const executeRevoke = async () => {
    if (!pendingRevoke) return;
    setBusy("revoke");
    setError("");
    try {
      await revokeToken(pendingRevoke.id);
      setTokens((current) =>
        current.map((token) =>
          token.id === pendingRevoke.id
            ? { ...token, status: "revoked" }
            : token
        )
      );
      setNotice(`${pendingRevoke.name} 已撤销，现有调用会立即失效。`);
      setPendingRevoke(null);
    } catch (requestError) {
      setError(requestMessage(requestError, "Token 撤销失败"));
    } finally {
      setBusy("");
    }
  };

  return (
    <ManagementPage activeKey="tokens">
      <ManagementHeader
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" size={17} />
            创建 Token
          </Button>
        }
        description="为自动化和集成创建最小权限访问凭证。"
        eyebrow="DEVELOPER ACCESS"
        title="API Token"
      />

      {notice && (
        <ManagementNotice onClose={() => setNotice("")} tone="success">
          {notice}
        </ManagementNotice>
      )}
      {error && (
        <ManagementNotice onClose={() => setError("")} tone="error">
          {error}
        </ManagementNotice>
      )}

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span><KeyRound aria-hidden="true" size={19} /></span>
          <small>有效 Token</small>
          <strong>{activeCount}</strong>
        </div>
        <div className={styles.metric}>
          <span><ShieldCheck aria-hidden="true" size={19} /></span>
          <small>已被使用</small>
          <strong>{usedCount}</strong>
        </div>
        <div className={styles.metric}>
          <span><CalendarClock aria-hidden="true" size={19} /></span>
          <small>即将过期</small>
          <strong>
            {
              tokens.filter((token) => {
                if (!token.expiresAt || token.status !== "active") return false;
                const remaining = new Date(token.expiresAt).getTime() - Date.now();
                return remaining > 0 && remaining < 7 * 24 * 60 * 60 * 1000;
              }).length
            }
          </strong>
        </div>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>访问凭证</h2>
            <p>这里只显示前缀，不保存或回显完整 Token。</p>
          </div>
          <Button onClick={() => void load()} size="compact" variant="ghost">
            <RefreshCw aria-hidden="true" size={15} />
            刷新
          </Button>
        </div>

        {loading ? (
          <LoadingPanel label="正在读取 API Token" />
        ) : denied ? (
          <AccessDenied />
        ) : tokens.length ? (
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>权限范围</th>
                  <th>IP 限制</th>
                  <th>状态</th>
                  <th>到期时间</th>
                  <th>最近使用</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>
                      <div className={styles.tokenIdentity}>
                        <span><KeyRound aria-hidden="true" size={16} /></span>
                        <div>
                          <strong>{token.name}</strong>
                          <code>{token.prefix}••••••••</code>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className={styles.scopeList}>
                        {token.scopes.map((scope) => (
                          <span key={scope}>{scope}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {token.ipAllowlist.length === 0 ? (
                        <span className={styles.allowlistOpen}>任意 IP</span>
                      ) : (
                        <div className={styles.scopeList}>
                          {token.ipAllowlist.slice(0, 2).map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                          {token.ipAllowlist.length > 2 && (
                            <span>+{token.ipAllowlist.length - 2}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>{tokenStatus(token)}</td>
                    <td>{formatManagementDate(token.expiresAt, "永不过期")}</td>
                    <td>{formatManagementDate(token.lastUsedAt)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        {token.status === "active" && (
                          <Button
                            aria-label={`撤销 ${token.name}`}
                            onClick={() => setPendingRevoke(token)}
                            size="icon"
                            title="撤销 Token"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel
            action={
              <Button onClick={() => setCreateOpen(true)} variant="secondary">
                <Plus aria-hidden="true" size={16} />
                创建第一个 Token
              </Button>
            }
            description="创建后完整 Token 只会展示一次，请立即保存到安全位置。"
            icon={KeyRound}
            title="还没有 API Token"
          />
        )}
      </section>

      <Dialog.Root onOpenChange={setCreateOpen} open={createOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
          <Dialog.Content className={cn(styles.dialog, styles.wideDialog)}>
            <div className={styles.dialogIcon}>
              <KeyRound aria-hidden="true" size={21} />
            </div>
            <Dialog.Title>创建 API Token</Dialog.Title>
            <Dialog.Description>
              只授予实际需要的权限。完整 Token 在关闭下一步窗口后无法恢复。
            </Dialog.Description>
            <div className={styles.formStack}>
              <label className={styles.field}>
                <span><strong>Token 名称</strong></span>
                <input
                  autoFocus
                  className={styles.input}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：CI 图片发布"
                  value={name}
                />
              </label>
              <div className={styles.field}>
                <span>
                  <strong>权限范围</strong>
                  <small>至少选择一项。</small>
                </span>
                <div className={styles.scopeOptions}>
                  {scopeOptions.map((scope) => {
                    const checked = scopes.includes(scope.id);
                    return (
                      <button
                        aria-pressed={checked}
                        className={cn(checked && styles.scopeOptionActive)}
                        key={scope.id}
                        onClick={() => toggleScope(scope.id)}
                        type="button"
                      >
                        <span className={styles.scopeCheck}>
                          {checked && <Check aria-hidden="true" size={13} />}
                        </span>
                        <span>
                          <strong>{scope.label}</strong>
                          <small>{scope.description}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className={styles.field}>
                <span>
                  <strong>有效期</strong>
                  <small>过期后必须创建新 Token。</small>
                </span>
                <select
                  className={styles.select}
                  onChange={(event) => setExpiry(event.target.value)}
                  value={expiry}
                >
                  <option value="7">7 天</option>
                  <option value="30">30 天</option>
                  <option value="90">90 天</option>
                  <option value="365">1 年</option>
                  <option value="0">永不过期</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>
                  <strong>IP / CIDR 白名单（可选）</strong>
                  <small>
                    每行一项，留空允许任意 IP；当前 {ipAllowlist.length} / 20。
                  </small>
                </span>
                <textarea
                  className={styles.textarea}
                  onChange={(event) => setIpAllowlistText(event.target.value)}
                  placeholder={"203.0.113.10\n198.51.100.0/24\n2001:db8::/32"}
                  rows={5}
                  value={ipAllowlistText}
                />
              </label>
            </div>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <Button disabled={busy === "create"} variant="secondary">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                disabled={
                  busy === "create" ||
                  !name.trim() ||
                  scopes.length === 0 ||
                  ipAllowlist.length > 20
                }
                onClick={() => void submitCreate()}
              >
                {busy === "create" ? (
                  <LoaderCircle className={styles.spin} size={16} />
                ) : (
                  <KeyRound aria-hidden="true" size={16} />
                )}
                创建 Token
              </Button>
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭创建窗口" className={styles.dialogClose}>
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <OneTimeSecretDialog
        description="请立即复制并保存到密码管理器或部署平台的 Secret 中。"
        label="API Token"
        onOpenChange={(open) => {
          if (!open) setOneTimeToken("");
        }}
        open={Boolean(oneTimeToken)}
        secret={oneTimeToken}
        title="Token 创建成功"
      />

      <ConfirmActionDialog
        busy={busy === "revoke"}
        confirmLabel="确认撤销"
        danger
        description={`${pendingRevoke?.name ?? "这个 Token"} 将立即失效，依赖它的自动化任务会停止工作。`}
        icon={Trash2}
        onConfirm={() => void executeRevoke()}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
        open={Boolean(pendingRevoke)}
        title="撤销 API Token？"
      />
    </ManagementPage>
  );
}
