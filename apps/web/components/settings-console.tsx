"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Badge, Button, cn } from "@ou-image/ui";
import {
  BellRing,
  Fingerprint,
  FolderCog,
  KeyRound,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  MonitorSmartphone,
  Palette,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  Users,
  X,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  beginTwoFactorSetup,
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  getSettingsData,
  regenerateRecoveryCodes,
  revokeOtherSessions,
  revokeSession,
  updateNotificationPreferences,
  updateProfile,
  updateWorkspace,
  type ActiveSession,
  type NotificationPreferences,
  type ProfileSettings,
  type SecuritySettings,
  type WorkspaceSettings
} from "@/lib/admin-api";
import { ApiError, applyTheme } from "@/lib/api";
import {
  AccessDenied,
  ConfirmActionDialog,
  LoadingPanel,
  ManagementHeader,
  ManagementNotice,
  ManagementPage,
  OneTimeSecretDialog,
  RoleBadge,
  formatManagementDate,
  managementStyles as styles,
  requestMessage
} from "./management-ui";

type SettingsSection =
  | "profile"
  | "security"
  | "notifications"
  | "sessions"
  | "workspace";

const settingsSections: Array<{
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "profile", label: "个人资料", icon: UserRound },
  { id: "security", label: "安全与 2FA", icon: ShieldCheck },
  { id: "notifications", label: "通知", icon: BellRing },
  { id: "sessions", label: "活跃会话", icon: MonitorSmartphone },
  { id: "workspace", label: "工作区", icon: Users }
];

const notificationCategories: Array<{
  key: "security" | "collaboration" | "system";
  label: string;
  description: string;
}> = [
  {
    key: "security",
    label: "安全事件",
    description: "登录、双重验证、密码和访问凭证相关的站内提醒。"
  },
  {
    key: "collaboration",
    label: "协作事件",
    description: "成员、邀请、分享与工作区协作相关的站内提醒。"
  },
  {
    key: "system",
    label: "系统事件",
    description: "存储、任务状态和实例运行状态相关的站内提醒。"
  }
];

function sessionDevice(session: ActiveSession) {
  const summary = session.userAgent ?? "";
  if (/mobile|iphone|android/i.test(summary)) {
    return { icon: Smartphone, label: summary || "移动设备" };
  }
  return { icon: Laptop, label: summary || "桌面浏览器" };
}

export function SettingsConsole() {
  const [section, setSection] = useState<SettingsSection>("profile");
  const [profile, setProfile] = useState<ProfileSettings | null>(null);
  const [security, setSecurity] = useState<SecuritySettings | null>(null);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences | null>(null);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [theme, setTheme] = useState<ProfileSettings["theme"]>("system");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorChallenge, setTwoFactorChallenge] = useState("");
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState("");
  const [passwordDialog, setPasswordDialog] = useState<
    "disable-2fa" | "recovery" | null
  >(null);
  const [confirmationPassword, setConfirmationPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [pendingSession, setPendingSession] =
    useState<ActiveSession | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await getSettingsData();
      setProfile(payload.profile);
      setSecurity(payload.security);
      setNotificationPreferences(payload.notifications);
      setSessions(payload.sessions);
      setWorkspace(payload.workspace);
      setDisplayName(payload.profile.displayName);
      setTheme(payload.profile.theme);
      setWorkspaceName(payload.workspace.name);
      setWorkspaceDescription(payload.workspace.description ?? "");
      setDenied(false);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 403) {
        setDenied(true);
      } else {
        setError(requestMessage(requestError, "设置加载失败"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const otherSessions = useMemo(
    () => sessions.filter((session) => !session.current),
    [sessions]
  );

  const saveNotifications = async () => {
    if (!notificationPreferences) return;
    setBusy("notifications");
    setError("");
    try {
      const payload = await updateNotificationPreferences(
        notificationPreferences
      );
      setNotificationPreferences(payload.preferences);
      setNotice("站内通知偏好已保存。");
    } catch (requestError) {
      setError(requestMessage(requestError, "通知偏好保存失败"));
    } finally {
      setBusy("");
    }
  };

  const saveProfile = async () => {
    if (!displayName.trim()) return;
    setBusy("profile");
    setError("");
    try {
      const payload = await updateProfile({
        displayName: displayName.trim(),
        theme
      });
      setProfile(payload.profile);
      applyTheme(payload.profile.theme);
      setNotice("个人资料已保存。");
    } catch (requestError) {
      setError(requestMessage(requestError, "个人资料保存失败"));
    } finally {
      setBusy("");
    }
  };

  const savePassword = async () => {
    if (!currentPassword || !newPassword) return;
    setBusy("password");
    setError("");
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setNotice("密码已更新，其他设备的会话可能需要重新登录。");
    } catch (requestError) {
      setError(requestMessage(requestError, "密码更新失败"));
    } finally {
      setBusy("");
    }
  };

  const startTwoFactor = async () => {
    if (!twoFactorPassword) return;
    setBusy("2fa-setup");
    setError("");
    try {
      const payload = await beginTwoFactorSetup(twoFactorPassword);
      setTwoFactorChallenge(payload.challengeToken);
      setTwoFactorSecret(payload.manualKey);
      setTwoFactorPassword("");
      setTwoFactorCode("");
    } catch (requestError) {
      setError(requestMessage(requestError, "双重验证初始化失败"));
    } finally {
      setBusy("");
    }
  };

  const confirmTwoFactor = async () => {
    if (!twoFactorChallenge || !twoFactorCode.trim()) return;
    setBusy("2fa-enable");
    setError("");
    try {
      const payload = await enableTwoFactor(
        twoFactorChallenge,
        twoFactorCode.trim()
      );
      setSecurity((current) => ({
        ...(current ?? { twoFactorEnabled: false }),
        twoFactorEnabled: true,
        recoveryCodesRemaining: payload.recoveryCodes.length
      }));
      setTwoFactorOpen(false);
      setTwoFactorPassword("");
      setTwoFactorChallenge("");
      setTwoFactorSecret("");
      setTwoFactorCode("");
      setRecoveryCodes(payload.recoveryCodes.join("\n"));
      setNotice("双重验证已启用。");
    } catch (requestError) {
      setError(requestMessage(requestError, "验证码无效或已过期"));
    } finally {
      setBusy("");
    }
  };

  const executePasswordAction = async () => {
    if (!passwordDialog || !confirmationPassword || !confirmationCode) return;
    setBusy("password-dialog");
    setError("");
    try {
      if (passwordDialog === "disable-2fa") {
        await disableTwoFactor({
          currentPassword: confirmationPassword,
          code: confirmationCode
        });
        setSecurity((current) => ({
          ...(current ?? { twoFactorEnabled: false }),
          twoFactorEnabled: false,
          recoveryCodesRemaining: 0
        }));
        setNotice("双重验证已关闭。");
      } else {
        const payload = await regenerateRecoveryCodes({
          currentPassword: confirmationPassword,
          code: confirmationCode
        });
        setRecoveryCodes(payload.recoveryCodes.join("\n"));
        setSecurity((current) => ({
          ...(current ?? { twoFactorEnabled: true }),
          recoveryCodesRemaining: payload.recoveryCodes.length
        }));
        setNotice("旧恢复码已失效。");
      }
      setPasswordDialog(null);
      setConfirmationPassword("");
      setConfirmationCode("");
    } catch (requestError) {
      setError(requestMessage(requestError, "身份验证失败"));
    } finally {
      setBusy("");
    }
  };

  const executeSessionRevoke = async () => {
    if (!pendingSession) return;
    setBusy("session");
    setError("");
    try {
      await revokeSession(pendingSession.id);
      setSessions((current) =>
        current.filter((session) => session.id !== pendingSession.id)
      );
      setPendingSession(null);
      setNotice("会话已撤销。");
    } catch (requestError) {
      setError(requestMessage(requestError, "会话撤销失败"));
    } finally {
      setBusy("");
    }
  };

  const executeRevokeOthers = async () => {
    setBusy("sessions-others");
    setError("");
    try {
      await revokeOtherSessions();
      setSessions((current) => current.filter((session) => session.current));
      setRevokeOthersOpen(false);
      setNotice("其他设备上的会话已全部撤销。");
    } catch (requestError) {
      setError(requestMessage(requestError, "其他会话撤销失败"));
    } finally {
      setBusy("");
    }
  };

  const saveWorkspace = async () => {
    if (!workspaceName.trim()) return;
    setBusy("workspace");
    setError("");
    try {
      const payload = await updateWorkspace({
        name: workspaceName.trim(),
        description: workspaceDescription.trim() || undefined
      });
      setWorkspace(payload.workspace);
      setNotice("工作区设置已保存。");
    } catch (requestError) {
      setError(requestMessage(requestError, "工作区设置保存失败"));
    } finally {
      setBusy("");
    }
  };

  const closeTwoFactor = (open: boolean) => {
    setTwoFactorOpen(open);
    if (!open) {
      setTwoFactorPassword("");
      setTwoFactorChallenge("");
      setTwoFactorSecret("");
      setTwoFactorCode("");
    }
  };

  return (
    <ManagementPage activeKey="settings">
      <ManagementHeader
        action={
          <Button onClick={() => void load()} variant="secondary">
            <RefreshCw aria-hidden="true" size={16} />
            刷新设置
          </Button>
        }
        description="管理个人安全、设备会话和当前工作区偏好。"
        eyebrow="ACCOUNT & WORKSPACE"
        title="设置中心"
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

      {loading ? (
        <section className={styles.panel}>
          <LoadingPanel label="正在读取账号与工作区设置" />
        </section>
      ) : denied ? (
        <section className={styles.panel}><AccessDenied /></section>
      ) : (
        <div className={styles.settingsLayout}>
          <nav aria-label="设置分区" className={styles.settingsNav}>
            {settingsSections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  aria-current={section === item.id ? "page" : undefined}
                  className={cn(
                    section === item.id && styles.settingsNavActive
                  )}
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={16} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className={styles.settingsContent}>
            {section === "profile" && profile && (
              <>
                <section className={styles.settingsCard}>
                  <div className={styles.settingsCardHead}>
                    <div>
                      <strong>个人资料</strong>
                      <span>用于工作区成员列表和操作记录。</span>
                    </div>
                    <UserRound aria-hidden="true" size={19} />
                  </div>
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span><strong>显示名称</strong></span>
                      <input
                        className={styles.input}
                        onChange={(event) => setDisplayName(event.target.value)}
                        value={displayName}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>
                        <strong>邮箱</strong>
                        <small>邮箱修改需要单独验证。</small>
                      </span>
                      <input
                        className={styles.input}
                        disabled
                        value={profile.email}
                      />
                    </label>
                    <label className={cn(styles.field, styles.spanFull)}>
                      <span><strong>界面主题</strong></span>
                      <div className={styles.themeChoices}>
                        {(["light", "dark", "system"] as const).map((value) => (
                          <button
                            aria-pressed={theme === value}
                            className={cn(
                              theme === value && styles.themeChoiceActive
                            )}
                            key={value}
                            onClick={() => setTheme(value)}
                            type="button"
                          >
                            <Palette aria-hidden="true" size={16} />
                            {value === "light"
                              ? "浅色"
                              : value === "dark"
                                ? "深色"
                                : "跟随系统"}
                          </button>
                        ))}
                      </div>
                    </label>
                  </div>
                  <div className={styles.cardActions}>
                    <Button
                      disabled={busy === "profile" || !displayName.trim()}
                      onClick={() => void saveProfile()}
                    >
                      {busy === "profile" ? (
                        <LoaderCircle className={styles.spin} size={16} />
                      ) : (
                        <Save aria-hidden="true" size={16} />
                      )}
                      保存资料
                    </Button>
                  </div>
                </section>
              </>
            )}

            {section === "security" && security && (
              <>
                <section className={styles.settingsCard}>
                  <div className={styles.settingsCardHead}>
                    <div>
                      <strong>修改密码</strong>
                      <span>建议使用密码管理器生成独立长密码。</span>
                    </div>
                    <LockKeyhole aria-hidden="true" size={19} />
                  </div>
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span><strong>当前密码</strong></span>
                      <input
                        autoComplete="current-password"
                        className={styles.input}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                        type="password"
                        value={currentPassword}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>
                        <strong>新密码</strong>
                        <small>至少 12 位并包含大小写、数字和符号。</small>
                      </span>
                      <input
                        autoComplete="new-password"
                        className={styles.input}
                        onChange={(event) => setNewPassword(event.target.value)}
                        type="password"
                        value={newPassword}
                      />
                    </label>
                  </div>
                  <div className={styles.cardActions}>
                    <Button
                      disabled={
                        busy === "password" ||
                        !currentPassword ||
                        !newPassword
                      }
                      onClick={() => void savePassword()}
                      variant="secondary"
                    >
                      {busy === "password" ? (
                        <LoaderCircle className={styles.spin} size={16} />
                      ) : (
                        <KeyRound aria-hidden="true" size={16} />
                      )}
                      更新密码
                    </Button>
                  </div>
                </section>

                <section className={styles.settingsCard}>
                  <div className={styles.settingsCardHead}>
                    <div>
                      <strong>双重验证</strong>
                      <span>使用验证器应用保护登录与高风险操作。</span>
                    </div>
                    {security.twoFactorEnabled ? (
                      <Badge tone="success">已启用</Badge>
                    ) : (
                      <Badge tone="warning">未启用</Badge>
                    )}
                  </div>
                  <div className={styles.securityFeature}>
                    <span>
                      <Fingerprint aria-hidden="true" size={24} />
                    </span>
                    <div>
                      <strong>
                        {security.twoFactorEnabled
                          ? "账号已受 TOTP 保护"
                          : "添加验证器应用"}
                      </strong>
                      <p>
                        {security.twoFactorEnabled
                          ? `剩余 ${security.recoveryCodesRemaining ?? 0} 个恢复码。`
                          : "支持 1Password、Authy、Google Authenticator 等标准验证器。"}
                      </p>
                    </div>
                    <div>
                      {security.twoFactorEnabled ? (
                        <>
                          <Button
                            onClick={() => setPasswordDialog("recovery")}
                            size="compact"
                            variant="secondary"
                          >
                            重新生成恢复码
                          </Button>
                          <Button
                            onClick={() => setPasswordDialog("disable-2fa")}
                            size="compact"
                            variant="ghost"
                          >
                            关闭 2FA
                          </Button>
                        </>
                      ) : (
                        <Button
                          onClick={() => setTwoFactorOpen(true)}
                          size="compact"
                        >
                          开始设置
                        </Button>
                      )}
                    </div>
                  </div>
                </section>
              </>
            )}

            {section === "notifications" && notificationPreferences && (
              <>
                <section className={styles.settingsCard}>
                  <div className={styles.settingsCardHead}>
                    <div>
                      <strong>站内通知</strong>
                      <span>选择要在顶部通知抽屉中保留的事件类别。</span>
                    </div>
                    <BellRing aria-hidden="true" size={19} />
                  </div>
                  <div className={styles.preferenceList}>
                    {notificationCategories.map((item) => (
                      <div className={styles.preferenceRow} key={item.key}>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.description}</span>
                        </div>
                        <button
                          aria-label={`${item.label}${
                            notificationPreferences[item.key]
                              ? "已开启"
                              : "已关闭"
                          }`}
                          aria-pressed={notificationPreferences[item.key]}
                          className={cn(
                            styles.preferenceSwitch,
                            notificationPreferences[item.key] &&
                              styles.preferenceSwitchActive
                          )}
                          onClick={() =>
                            setNotificationPreferences((current) =>
                              current
                                ? {
                                    ...current,
                                    [item.key]: !current[item.key]
                                  }
                                : current
                            )
                          }
                          type="button"
                        >
                          <span />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className={styles.settingsCard}>
                  <div className={styles.settingsCardHead}>
                    <div>
                      <strong>免打扰时段</strong>
                      <span>期间隐藏顶部红点，但通知仍会保留在抽屉中。</span>
                    </div>
                    <button
                      aria-label={
                        notificationPreferences.quietHours.enabled
                          ? "关闭免打扰时段"
                          : "开启免打扰时段"
                      }
                      aria-pressed={
                        notificationPreferences.quietHours.enabled
                      }
                      className={cn(
                        styles.preferenceSwitch,
                        notificationPreferences.quietHours.enabled &&
                          styles.preferenceSwitchActive
                      )}
                      onClick={() =>
                        setNotificationPreferences((current) =>
                          current
                            ? {
                                ...current,
                                quietHours: {
                                  ...current.quietHours,
                                  enabled: !current.quietHours.enabled
                                }
                              }
                            : current
                        )
                      }
                      type="button"
                    >
                      <span />
                    </button>
                  </div>
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span><strong>开始时间</strong></span>
                      <input
                        className={styles.input}
                        disabled={!notificationPreferences.quietHours.enabled}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  quietHours: {
                                    ...current.quietHours,
                                    start: event.target.value
                                  }
                                }
                              : current
                          )
                        }
                        type="time"
                        value={notificationPreferences.quietHours.start}
                      />
                    </label>
                    <label className={styles.field}>
                      <span><strong>结束时间</strong></span>
                      <input
                        className={styles.input}
                        disabled={!notificationPreferences.quietHours.enabled}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  quietHours: {
                                    ...current.quietHours,
                                    end: event.target.value
                                  }
                                }
                              : current
                          )
                        }
                        type="time"
                        value={notificationPreferences.quietHours.end}
                      />
                    </label>
                    <label className={cn(styles.field, styles.spanFull)}>
                      <span>
                        <strong>时区</strong>
                        <small>使用 IANA 时区，例如 Asia/Shanghai。</small>
                      </span>
                      <input
                        className={styles.input}
                        disabled={!notificationPreferences.quietHours.enabled}
                        onChange={(event) =>
                          setNotificationPreferences((current) =>
                            current
                              ? {
                                  ...current,
                                  quietHours: {
                                    ...current.quietHours,
                                    timezone: event.target.value
                                  }
                                }
                              : current
                          )
                        }
                        placeholder="Asia/Shanghai"
                        value={notificationPreferences.quietHours.timezone}
                      />
                    </label>
                  </div>
                  <div className={styles.cardActions}>
                    <Button
                      disabled={
                        busy === "notifications" ||
                        !notificationPreferences.quietHours.start ||
                        !notificationPreferences.quietHours.end ||
                        !notificationPreferences.quietHours.timezone.trim()
                      }
                      onClick={() => void saveNotifications()}
                    >
                      {busy === "notifications" ? (
                        <LoaderCircle className={styles.spin} size={16} />
                      ) : (
                        <Save aria-hidden="true" size={16} />
                      )}
                      保存通知偏好
                    </Button>
                  </div>
                </section>
              </>
            )}

            {section === "sessions" && (
              <section className={styles.settingsCard}>
                <div className={styles.settingsCardHead}>
                  <div>
                    <strong>活跃会话</strong>
                    <span>撤销不认识或不再使用的设备。</span>
                  </div>
                  <Button
                    disabled={otherSessions.length === 0}
                    onClick={() => setRevokeOthersOpen(true)}
                    size="compact"
                    variant="secondary"
                  >
                    撤销其他会话
                  </Button>
                </div>
                <div className={styles.sessionList}>
                  {sessions.map((session) => {
                    const device = sessionDevice(session);
                    const DeviceIcon = device.icon;
                    return (
                      <article key={session.id}>
                        <span>
                          <DeviceIcon aria-hidden="true" size={19} />
                        </span>
                        <div>
                          <div>
                            <strong>{device.label}</strong>
                            {session.current && <Badge tone="success">当前设备</Badge>}
                          </div>
                          <small>
                            最近活动 {formatManagementDate(session.lastSeenAt)}
                            {" · "}
                            到期 {formatManagementDate(session.expiresAt)}
                          </small>
                        </div>
                        {!session.current && (
                          <Button
                            aria-label={`撤销 ${device.label} 会话`}
                            onClick={() => setPendingSession(session)}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </Button>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {section === "workspace" && workspace && (
              <>
                <section className={styles.settingsCard}>
                  <div className={styles.settingsCardHead}>
                    <div>
                      <strong>工作区设置</strong>
                      <span>名称会显示在侧栏切换器和邀请页面。</span>
                    </div>
                    <RoleBadge role={workspace.role} />
                  </div>
                  <div className={styles.formStack}>
                    <label className={styles.field}>
                      <span><strong>工作区名称</strong></span>
                      <input
                        className={styles.input}
                        disabled={
                          workspace.role !== "owner" &&
                          workspace.role !== "admin"
                        }
                        onChange={(event) => setWorkspaceName(event.target.value)}
                        value={workspaceName}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>
                        <strong>描述</strong>
                        <small>帮助成员确认当前工作区用途。</small>
                      </span>
                      <textarea
                        className={styles.textarea}
                        disabled={
                          workspace.role !== "owner" &&
                          workspace.role !== "admin"
                        }
                        onChange={(event) =>
                          setWorkspaceDescription(event.target.value)
                        }
                        value={workspaceDescription}
                      />
                    </label>
                  </div>
                  {(workspace.role === "owner" ||
                    workspace.role === "admin") && (
                    <div className={styles.cardActions}>
                      <Button
                        disabled={busy === "workspace" || !workspaceName.trim()}
                        onClick={() => void saveWorkspace()}
                      >
                        {busy === "workspace" ? (
                          <LoaderCircle className={styles.spin} size={16} />
                        ) : (
                          <Save aria-hidden="true" size={16} />
                        )}
                        保存工作区
                      </Button>
                    </div>
                  )}
                </section>

                {profile?.siteRole === "owner" && (
                  <section className={styles.storageEntry}>
                    <span>
                      <FolderCog aria-hidden="true" size={21} />
                    </span>
                    <div>
                      <strong>实例存储与分发</strong>
                      <p>此入口仅站点 Owner 可见，用于配置 S3、R2、域名与备份。</p>
                    </div>
                    <Button asChild size="compact" variant="secondary">
                      <Link href="/storage">打开存储设置</Link>
                    </Button>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Dialog.Root onOpenChange={closeTwoFactor} open={twoFactorOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
          <Dialog.Content className={cn(styles.dialog, styles.wideDialog)}>
            <div className={styles.dialogIcon}>
              <Fingerprint aria-hidden="true" size={21} />
            </div>
            <Dialog.Title>设置双重验证</Dialog.Title>
            <Dialog.Description>
              {twoFactorChallenge
                ? "在验证器中手动输入密钥，然后提交 6 位验证码。"
                : "先输入当前密码确认身份，再生成一次性设置密钥。"}
            </Dialog.Description>
            <div className={styles.twoFactorSetup}>
              {twoFactorChallenge ? (
                <>
                  <div className={styles.manualKey}>
                    <span>手动设置密钥</span>
                    <code>{twoFactorSecret}</code>
                  </div>
                  <label className={styles.field}>
                    <span><strong>验证码</strong></span>
                    <input
                      autoComplete="one-time-code"
                      className={styles.input}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) =>
                        setTwoFactorCode(
                          event.target.value.replace(/\D/g, "")
                        )
                      }
                      placeholder="000000"
                      value={twoFactorCode}
                    />
                  </label>
                </>
              ) : (
                <label className={styles.field}>
                  <span><strong>当前密码</strong></span>
                  <input
                    autoComplete="current-password"
                    autoFocus
                    className={styles.input}
                    onChange={(event) =>
                      setTwoFactorPassword(event.target.value)
                    }
                    type="password"
                    value={twoFactorPassword}
                  />
                </label>
              )}
            </div>
            <div className={styles.dialogActions}>
              <Button
                disabled={
                  busy === "2fa-enable" || busy === "2fa-setup"
                }
                onClick={() => closeTwoFactor(false)}
                variant="secondary"
              >
                取消
              </Button>
              {twoFactorChallenge ? (
                <Button
                  disabled={
                    busy === "2fa-enable" || twoFactorCode.length !== 6
                  }
                  onClick={() => void confirmTwoFactor()}
                >
                  {busy === "2fa-enable" && (
                    <LoaderCircle className={styles.spin} size={16} />
                  )}
                  验证并启用
                </Button>
              ) : (
                <Button
                  disabled={busy === "2fa-setup" || !twoFactorPassword}
                  onClick={() => void startTwoFactor()}
                >
                  {busy === "2fa-setup" && (
                    <LoaderCircle className={styles.spin} size={16} />
                  )}
                  生成设置密钥
                </Button>
              )}
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭设置窗口" className={styles.dialogClose}>
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <OneTimeSecretDialog
        description="这些恢复码只展示一次。每个恢复码只能使用一次，请离线保存。"
        label="恢复码"
        onOpenChange={(open) => {
          if (!open) setRecoveryCodes("");
        }}
        open={Boolean(recoveryCodes)}
        secret={recoveryCodes}
        title="保存恢复码"
      />

      <Dialog.Root
        onOpenChange={(open) => {
          if (!open) {
            setPasswordDialog(null);
            setConfirmationPassword("");
            setConfirmationCode("");
          }
        }}
        open={Boolean(passwordDialog)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
          <Dialog.Content className={styles.dialog}>
            <div className={styles.dialogIcon}>
              <LockKeyhole aria-hidden="true" size={21} />
            </div>
            <Dialog.Title>
              {passwordDialog === "disable-2fa"
                ? "关闭双重验证？"
                : "重新生成恢复码？"}
            </Dialog.Title>
            <Dialog.Description>
              输入当前密码，以及验证器验证码或任一未使用的恢复码。
            </Dialog.Description>
            <label className={styles.field}>
              <span><strong>当前密码</strong></span>
              <input
                autoComplete="current-password"
                className={styles.input}
                onChange={(event) =>
                  setConfirmationPassword(event.target.value)
                }
                type="password"
                value={confirmationPassword}
              />
            </label>
            <label className={styles.field}>
              <span><strong>验证码或恢复码</strong></span>
              <input
                autoComplete="one-time-code"
                className={styles.input}
                onChange={(event) => setConfirmationCode(event.target.value)}
                value={confirmationCode}
              />
            </label>
            <div className={styles.dialogActions}>
              <Button
                disabled={busy === "password-dialog"}
                onClick={() => {
                  setPasswordDialog(null);
                  setConfirmationPassword("");
                  setConfirmationCode("");
                }}
                variant="secondary"
              >
                取消
              </Button>
              <Button
                disabled={
                  busy === "password-dialog" ||
                  !confirmationPassword ||
                  !confirmationCode
                }
                onClick={() => void executePasswordAction()}
                variant={
                  passwordDialog === "disable-2fa" ? "danger" : "primary"
                }
              >
                {busy === "password-dialog" && (
                  <LoaderCircle className={styles.spin} size={16} />
                )}
                确认
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmActionDialog
        busy={busy === "session"}
        confirmLabel="撤销会话"
        danger
        description="该设备会立即退出登录，未保存的操作可能丢失。"
        icon={Trash2}
        onConfirm={() => void executeSessionRevoke()}
        onOpenChange={(open) => !open && setPendingSession(null)}
        open={Boolean(pendingSession)}
        title="撤销这个设备的会话？"
      />

      <ConfirmActionDialog
        busy={busy === "sessions-others"}
        confirmLabel="撤销其他会话"
        danger
        description={`将撤销 ${otherSessions.length} 个其他设备会话，当前设备保持登录。`}
        icon={MonitorSmartphone}
        onConfirm={() => void executeRevokeOthers()}
        onOpenChange={setRevokeOthersOpen}
        open={revokeOthersOpen}
        title="退出其他所有设备？"
      />
    </ManagementPage>
  );
}
