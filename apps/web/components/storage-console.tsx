"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Badge, Button, cn } from "@ou-image/ui";
import {
  AlertCircle,
  ArchiveRestore,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  Database,
  Download,
  FileArchive,
  Globe2,
  HardDrive,
  History,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
  type LucideIcon
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { apiRequest } from "@/lib/api";
import { AppShell } from "./app-shell";
import styles from "./storage-console.module.css";

type ProviderKey = "local" | "s3" | "r2";
type StorageTab = "providers" | "delivery" | "hotlink" | "migrations" | "backups";

type RemoteProviderConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretConfigured: boolean;
  publicBaseUrl: string;
  pathStyle: boolean;
};

type StorageSettings = {
  storage: {
    active: ProviderKey;
    local: { configured?: boolean; directory?: string };
    s3: RemoteProviderConfig;
    r2: RemoteProviderConfig;
  };
  delivery: {
    customDomain: string;
    linkTemplate: string;
    hotlinkEnabled: boolean;
    allowedReferers: string[];
    allowEmptyReferer: boolean;
    signedUrls: boolean;
    signedUrlTtlSeconds: number;
  };
  backup: {
    scheduleEnabled: boolean;
    intervalHours: number;
    retentionCount: number;
    lastBackupAt?: string;
  };
};

type ProviderHealth = {
  ok?: boolean;
  status?: string;
  latencyMs?: number;
  message?: string;
  files?: number;
  bytes?: number;
  freeBytes?: number;
  totalBytes?: number;
};

type StorageHealth = {
  active: ProviderKey;
  providers:
    | Partial<Record<ProviderKey, ProviderHealth>>
    | Array<ProviderHealth & { provider: ProviderKey }>;
};

type Migration = {
  id: string;
  source: ProviderKey;
  target: ProviderKey;
  status: "running" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
};

type Backup = {
  id: string;
  status: "running" | "completed" | "failed";
  size?: number;
  fileCount: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
};

const emptySettings: StorageSettings = {
  storage: {
    active: "local",
    local: { configured: true },
    s3: {
      endpoint: "",
      region: "",
      bucket: "",
      accessKeyId: "",
      secretConfigured: false,
      publicBaseUrl: "",
      pathStyle: false
    },
    r2: {
      endpoint: "",
      region: "auto",
      bucket: "",
      accessKeyId: "",
      secretConfigured: false,
      publicBaseUrl: "",
      pathStyle: false
    }
  },
  delivery: {
    customDomain: "",
    linkTemplate: "{domain}/api/files/{id}/{variant}",
    hotlinkEnabled: false,
    allowedReferers: [],
    allowEmptyReferer: true,
    signedUrls: false,
    signedUrlTtlSeconds: 3600
  },
  backup: {
    scheduleEnabled: false,
    intervalHours: 24,
    retentionCount: 7
  }
};

const providerMeta: Record<
  ProviderKey,
  { label: string; description: string; icon: LucideIcon; accent: string }
> = {
  local: {
    label: "本地存储",
    description: "直接写入服务器磁盘，部署简单、响应快速。",
    icon: HardDrive,
    accent: "#6d6d69"
  },
  s3: {
    label: "Amazon S3",
    description: "连接任意 S3 或兼容对象存储服务。",
    icon: Cloud,
    accent: "#e3a34f"
  },
  r2: {
    label: "Cloudflare R2",
    description: "低出口成本，适合搭配自定义域名分发。",
    icon: UploadCloud,
    accent: "#ef8f8f"
  }
};

const tabs: Array<{
  id: StorageTab;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}> = [
  { id: "providers", label: "存储与提供商", shortLabel: "存储", icon: Database },
  { id: "delivery", label: "域名与链接", shortLabel: "域名", icon: Globe2 },
  { id: "hotlink", label: "防盗链与签名", shortLabel: "安全", icon: ShieldCheck },
  { id: "migrations", label: "数据迁移", shortLabel: "迁移", icon: History },
  { id: "backups", label: "备份与恢复", shortLabel: "备份", icon: FileArchive }
];

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(value?: string) {
  if (!value) return "尚未执行";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function requestMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function providerHealth(
  health: StorageHealth | null,
  provider: ProviderKey
): ProviderHealth | undefined {
  if (!health) return undefined;
  if (Array.isArray(health.providers)) {
    return health.providers.find((item) => item.provider === provider);
  }
  return health.providers[provider];
}

function providerIsHealthy(value?: ProviderHealth) {
  if (!value) return false;
  if (typeof value.ok === "boolean") return value.ok;
  return ["connected", "healthy", "ready", "ok"].includes(
    value.status?.toLowerCase() ?? ""
  );
}

function providerStateCopy(value: ProviderHealth) {
  if (providerIsHealthy(value)) return "连接正常";
  if (value.status === "configured") return "已配置";
  if (value.status === "unconfigured") return "未配置";
  return "连接异常";
}

function normalizeSettings(payload: StorageSettings): StorageSettings {
  return {
    storage: {
      active: payload.storage.active,
      local: {
        configured: payload.storage.local?.configured ?? true,
        directory: payload.storage.local?.directory
      },
      s3: {
        ...emptySettings.storage.s3,
        ...payload.storage.s3,
        publicBaseUrl: payload.storage.s3.publicBaseUrl ?? ""
      },
      r2: {
        ...emptySettings.storage.r2,
        ...payload.storage.r2,
        publicBaseUrl: payload.storage.r2.publicBaseUrl ?? ""
      }
    },
    delivery: {
      ...emptySettings.delivery,
      ...payload.delivery,
      customDomain: payload.delivery.customDomain ?? "",
      allowedReferers: payload.delivery.allowedReferers ?? []
    },
    backup: {
      ...emptySettings.backup,
      ...payload.backup
    }
  };
}

function remotePayload(config: RemoteProviderConfig, secret?: string) {
  return {
    ...(config.endpoint.trim() ? { endpoint: config.endpoint.trim() } : {}),
    ...(config.region.trim() ? { region: config.region.trim() } : {}),
    ...(config.bucket.trim() ? { bucket: config.bucket.trim() } : {}),
    ...(config.accessKeyId.trim()
      ? { accessKeyId: config.accessKeyId.trim() }
      : {}),
    publicBaseUrl: config.publicBaseUrl.trim() || null,
    pathStyle: config.pathStyle,
    ...(secret ? { secretAccessKey: secret } : {})
  };
}

function hasRemoteConfiguration(
  config: RemoteProviderConfig,
  secret?: string
) {
  return Boolean(
    config.secretConfigured ||
      secret ||
      config.endpoint.trim() ||
      config.bucket.trim() ||
      config.accessKeyId.trim() ||
      config.publicBaseUrl.trim()
  );
}

function migrationProgress(migration: Migration) {
  if (migration.status === "completed") return 100;
  if (!migration.total) return migration.status === "running" ? 8 : 0;
  return Math.min(
    100,
    Math.round((migration.completed / migration.total) * 100)
  );
}

function StatusNotice({
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
    <div className={cn(styles.notice, styles[`notice_${tone}`])} role="status">
      <Icon aria-hidden="true" size={17} />
      <span>{children}</span>
      <button aria-label="关闭提示" onClick={onClose} type="button">
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(styles.toggle, checked && styles.toggleActive)}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

function Field({
  label,
  hint,
  children,
  wide
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={cn(styles.field, wide && styles.fieldWide)}>
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({
  icon: Icon,
  eyebrow,
  title,
  description,
  action
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.sectionTitle}>
      <div className={styles.sectionIcon}>
        <Icon aria-hidden="true" size={19} />
      </div>
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && <div className={styles.sectionAction}>{action}</div>}
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  icon: Icon,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: LucideIcon;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
        <Dialog.Content className={styles.dialog}>
          <div className={cn(styles.dialogIcon, danger && styles.dialogIconDanger)}>
            <Icon aria-hidden="true" size={22} />
          </div>
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{description}</Dialog.Description>
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

export function StorageConsole() {
  const [activeTab, setActiveTab] = useState<StorageTab>("providers");
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderKey>("local");
  const [settings, setSettings] = useState<StorageSettings>(emptySettings);
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [secrets, setSecrets] = useState({ s3: "", r2: "" });
  const [refererInput, setRefererInput] = useState("");
  const [migrationTarget, setMigrationTarget] = useState<ProviderKey>("s3");
  const [pendingRestore, setPendingRestore] = useState<Backup | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Backup | null>(null);
  const [migrationDialog, setMigrationDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [tests, setTests] = useState<
    Partial<Record<ProviderKey, ProviderHealth>>
  >({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [settingsPayload, healthPayload, migrationPayload, backupPayload] =
        await Promise.all([
          apiRequest<StorageSettings>("/storage/settings"),
          apiRequest<StorageHealth>("/storage/health"),
          apiRequest<{ migrations: Migration[] }>("/storage/migrations"),
          apiRequest<{ backups: Backup[] }>("/backups")
        ]);
      setSettings(normalizeSettings(settingsPayload));
      setHealth(healthPayload);
      setMigrations(migrationPayload.migrations);
      setBackups(backupPayload.backups);
      setSelectedProvider("local");
      setMigrationTarget("s3");
    } catch (requestError) {
      setError(requestMessage(requestError, "存储配置加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!migrations.some((item) => item.status === "running")) return;
    const timer = window.setInterval(async () => {
      try {
        const payload = await apiRequest<{ migrations: Migration[] }>(
          "/storage/migrations"
        );
        setMigrations(payload.migrations);
      } catch {
        // 保留当前进度；下一次轮询会继续尝试。
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [migrations]);

  const localHealth = providerHealth(health, "local");
  const usageBytes = localHealth?.bytes ?? 0;
  const quotaBytes = localHealth?.totalBytes ?? 0;
  const objectCount = localHealth?.files ?? 0;
  const usagePercent = quotaBytes
    ? Math.min(100, Math.round((usageBytes / quotaBytes) * 100))
    : 0;
  const actualActive = health?.active ?? "local";

  const previewUrl = useMemo(() => {
    const domain =
      settings.delivery.customDomain.trim().replace(/\/+$/, "") ||
      "https://img.example.com";
    const rendered = settings.delivery.linkTemplate
      .replaceAll("{domain}", domain)
      .replaceAll("{id}", "01J2OUIMAGE")
      .replaceAll("{variant}", "original")
      .replaceAll("{path}", "files/01J2OUIMAGE/original");
    if (/^https?:\/\//i.test(rendered)) return rendered;
    return `${domain}${rendered.startsWith("/") ? "" : "/"}${rendered}`;
  }, [settings.delivery.customDomain, settings.delivery.linkTemplate]);

  const updateRemote = (
    provider: "s3" | "r2",
    key: keyof RemoteProviderConfig,
    value: string | boolean
  ) => {
    setSettings((current) => ({
      ...current,
      storage: {
        ...current.storage,
        [provider]: { ...current.storage[provider], [key]: value }
      }
    }));
  };

  const saveSettings = async (scope: "storage" | "delivery" | "backup") => {
    setBusy(`save-${scope}`);
    setNotice("");
    setError("");
    try {
      const storagePayload = {
        active: "local" as const,
        ...(hasRemoteConfiguration(settings.storage.s3, secrets.s3)
          ? { s3: remotePayload(settings.storage.s3, secrets.s3) }
          : {}),
        ...(hasRemoteConfiguration(settings.storage.r2, secrets.r2)
          ? { r2: remotePayload(settings.storage.r2, secrets.r2) }
          : {})
      };
      const payload =
        scope === "storage"
          ? { storage: storagePayload }
          : scope === "delivery"
            ? {
                delivery: {
                  ...settings.delivery,
                  customDomain: settings.delivery.customDomain.trim() || null
                }
              }
            : { backup: settings.backup };
      const response = await apiRequest<StorageSettings>("/storage/settings", {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setSettings(normalizeSettings(response));
      setSecrets({ s3: "", r2: "" });
      setNotice(
        scope === "storage"
          ? "存储提供商配置已保存"
          : scope === "delivery"
            ? "域名与访问策略已保存"
            : "备份计划已保存"
      );
      const nextHealth = await apiRequest<StorageHealth>("/storage/health");
      setHealth(nextHealth);
    } catch (requestError) {
      setError(requestMessage(requestError, "配置保存失败"));
    } finally {
      setBusy("");
    }
  };

  const testProvider = async (provider: ProviderKey) => {
    setBusy(`test-${provider}`);
    setError("");
    try {
      const result = await apiRequest<ProviderHealth>("/storage/test", {
        method: "POST",
        body: JSON.stringify(
          provider === "local"
            ? { provider }
            : {
                provider,
                config: remotePayload(
                  settings.storage[provider],
                  secrets[provider]
                )
              }
        )
      });
      setTests((current) => ({ ...current, [provider]: result }));
    } catch (requestError) {
      const message = requestMessage(requestError, "连接测试失败");
      setTests((current) => ({
        ...current,
        [provider]: { ok: false, message }
      }));
    } finally {
      setBusy("");
    }
  };

  const addReferer = () => {
    const value = refererInput.trim();
    if (!value) return;
    let origin: string;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      origin = parsed.origin;
    } catch {
      setError("请输入完整的 HTTP 或 HTTPS Origin，例如 https://example.com");
      return;
    }
    if (settings.delivery.allowedReferers.includes(origin)) {
      setRefererInput("");
      return;
    }
    setSettings((current) => ({
      ...current,
      delivery: {
        ...current.delivery,
        allowedReferers: [...current.delivery.allowedReferers, origin]
      }
    }));
    setRefererInput("");
  };

  const removeReferer = (value: string) => {
    setSettings((current) => ({
      ...current,
      delivery: {
        ...current.delivery,
        allowedReferers: current.delivery.allowedReferers.filter(
          (item) => item !== value
        )
      }
    }));
  };

  const createMigration = async () => {
    setBusy("migration");
    setError("");
    try {
      const payload = await apiRequest<{ migration: Migration }>(
        "/storage/migrations",
        {
          method: "POST",
          body: JSON.stringify({
            source: "local",
            target: migrationTarget
          })
        }
      );
      setMigrations((current) => [payload.migration, ...current]);
      setMigrationDialog(false);
      setNotice(
        payload.migration.status === "completed"
          ? `迁移已完成：${payload.migration.completed} 个对象已复制`
          : "迁移任务已创建"
      );
    } catch (requestError) {
      setError(requestMessage(requestError, "迁移任务创建失败"));
    } finally {
      setBusy("");
    }
  };

  const createBackup = async () => {
    setBusy("backup-create");
    setError("");
    try {
      const payload = await apiRequest<{ backup: Backup }>("/backups", {
        method: "POST",
        body: JSON.stringify({})
      });
      setBackups((current) => [payload.backup, ...current]);
      setNotice(
        payload.backup.status === "completed"
          ? `备份已创建：${payload.backup.fileCount} 个文件`
          : "备份任务已创建"
      );
    } catch (requestError) {
      setError(requestMessage(requestError, "备份创建失败"));
    } finally {
      setBusy("");
    }
  };

  const restoreBackup = async () => {
    if (!pendingRestore) return;
    setBusy("backup-restore");
    setError("");
    try {
      await apiRequest(`/backups/${pendingRestore.id}/restore`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setPendingRestore(null);
      setNotice("备份已恢复，请刷新页面确认数据状态");
    } catch (requestError) {
      setError(requestMessage(requestError, "备份恢复失败"));
    } finally {
      setBusy("");
    }
  };

  const deleteBackup = async () => {
    if (!pendingDelete) return;
    setBusy("backup-delete");
    setError("");
    try {
      await apiRequest(`/backups/${pendingDelete.id}`, { method: "DELETE" });
      setBackups((current) =>
        current.filter((item) => item.id !== pendingDelete.id)
      );
      setPendingDelete(null);
      setNotice("备份已删除");
    } catch (requestError) {
      setError(requestMessage(requestError, "备份删除失败"));
    } finally {
      setBusy("");
    }
  };

  const copyPreview = async () => {
    await navigator.clipboard.writeText(previewUrl);
    setNotice("示例链接已复制");
  };

  if (loading) {
    return (
      <AppShell activeKey="storage">
        <main className={cn("workspace-page", styles.page)}>
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonGrid}>
            <div />
            <div />
            <div />
          </div>
          <div className={styles.skeletonPanel} />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell activeKey="storage">
      <main className={cn("workspace-page", styles.page)}>
        <header className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>STORAGE INFRASTRUCTURE</span>
            <h1>存储与分发</h1>
            <p>连接存储、控制链接策略，并让迁移与备份保持可见。</p>
          </div>
          <div className={styles.heroStatus}>
            <span className={styles.liveDot} />
            <div>
              <strong>{providerMeta[actualActive].label}</strong>
              <small>当前主存储运行中</small>
            </div>
          </div>
        </header>

        {notice && (
          <StatusNotice onClose={() => setNotice("")} tone="success">
            {notice}
          </StatusNotice>
        )}
        {error && (
          <StatusNotice onClose={() => setError("")} tone="error">
            {error}
          </StatusNotice>
        )}

        <section className={styles.metrics} aria-label="存储概览">
          <div className={styles.metricPrimary}>
            <div className={styles.metricIcon}>
              <Database aria-hidden="true" size={20} />
            </div>
            <div>
              <span>已用容量</span>
              <strong>{formatBytes(usageBytes)}</strong>
              <small>
                {quotaBytes ? `共 ${formatBytes(quotaBytes)}` : "未设置容量上限"}
              </small>
            </div>
            <div
              className={styles.capacityRing}
              style={{ "--usage": `${usagePercent * 3.6}deg` } as CSSProperties}
            >
              <span>{usagePercent}%</span>
            </div>
          </div>
          <div className={styles.metric}>
            <Box aria-hidden="true" size={19} />
            <span>图片对象</span>
            <strong>{objectCount.toLocaleString("zh-CN")}</strong>
            <small>所有版本与缩略图</small>
          </div>
          <div className={styles.metric}>
            <Server aria-hidden="true" size={19} />
            <span>活动提供商</span>
            <strong>{providerMeta[actualActive].label}</strong>
            <small>
              {providerHealth(health, actualActive)?.latencyMs
                ? `${providerHealth(health, actualActive)?.latencyMs} ms 延迟`
                : "等待延迟采样"}
            </small>
          </div>
          <div className={styles.metric}>
            <FileArchive aria-hidden="true" size={19} />
            <span>最近备份</span>
            <strong>{backups.filter((item) => item.status === "completed").length}</strong>
            <small>{formatDate(settings.backup.lastBackupAt)}</small>
          </div>
        </section>

        <nav aria-label="存储设置区域" className={styles.tabs}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={cn(activeTab === tab.id && styles.tabActive)}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon aria-hidden="true" size={16} />
                <span className={styles.tabFull}>{tab.label}</span>
                <span className={styles.tabShort}>{tab.shortLabel}</span>
              </button>
            );
          })}
        </nav>

        {activeTab === "providers" && (
          <section className={styles.tabPanel}>
            <SectionTitle
              description="选择图片写入位置，保存前可先验证连接状态。"
              eyebrow="PROVIDERS"
              icon={Database}
              title="存储提供商"
              action={
                <Button
                  disabled={busy === "save-storage"}
                  onClick={() => void saveSettings("storage")}
                  size="compact"
                >
                  {busy === "save-storage" ? (
                    <LoaderCircle className={styles.spin} size={16} />
                  ) : (
                    <Save aria-hidden="true" size={16} />
                  )}
                  保存配置
                </Button>
              }
            />

            <div className={styles.providerPicker}>
              {(Object.keys(providerMeta) as ProviderKey[]).map((provider) => {
                const meta = providerMeta[provider];
                const Icon = meta.icon;
                const state =
                  tests[provider] ?? providerHealth(health, provider);
                const selected = selectedProvider === provider;
                const active = actualActive === provider;
                return (
                  <button
                    className={cn(
                      styles.providerCard,
                      selected && styles.providerActive
                    )}
                    key={provider}
                    onClick={() => setSelectedProvider(provider)}
                    style={{ "--provider-accent": meta.accent } as CSSProperties}
                    type="button"
                  >
                    <span className={styles.providerIcon}>
                      <Icon aria-hidden="true" size={21} />
                    </span>
                    <span className={styles.providerCopy}>
                      <strong>{meta.label}</strong>
                      <small>{meta.description}</small>
                    </span>
                    <span className={styles.providerState}>
                      {active && <Badge tone="success">当前使用</Badge>}
                      {selected && !active && <Badge tone="info">正在配置</Badge>}
                      {state && (
                        <span
                          className={cn(
                            styles.health,
                            state.status === "configured" &&
                              styles.healthConfigured,
                            providerIsHealthy(state) && styles.healthGood
                          )}
                        >
                          {providerIsHealthy(state) ||
                          state.status === "configured" ? (
                            <Check size={13} />
                          ) : (
                            <X size={13} />
                          )}
                          {providerStateCopy(state)}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={styles.providerConfig}>
              <div className={styles.configHead}>
                <div>
                  <span>当前编辑</span>
                  <h3>{providerMeta[selectedProvider].label}</h3>
                </div>
                <Button
                  disabled={busy === `test-${selectedProvider}`}
                  onClick={() => void testProvider(selectedProvider)}
                  size="compact"
                  variant="secondary"
                >
                  {busy === `test-${selectedProvider}` ? (
                    <LoaderCircle className={styles.spin} size={15} />
                  ) : (
                    <RefreshCw aria-hidden="true" size={15} />
                  )}
                  测试连接
                </Button>
              </div>

              {selectedProvider === "local" ? (
                <div className={styles.fieldGrid}>
                  <Field
                    hint="本地目录由服务端 OU_DATA_DIR 环境变量管理。"
                    label="本地数据目录"
                    wide
                  >
                    <input
                      readOnly
                      value={
                        settings.storage.local.directory ??
                        "OU_DATA_DIR/storage"
                      }
                    />
                  </Field>
                </div>
              ) : (
                <RemoteProviderFields
                  config={settings.storage[selectedProvider]}
                  onChange={(key, value) =>
                    updateRemote(selectedProvider as "s3" | "r2", key, value)
                  }
                  onSecretChange={(value) =>
                    setSecrets((current) => ({
                      ...current,
                      [selectedProvider]: value
                    }))
                  }
                  provider={selectedProvider}
                  secret={secrets[selectedProvider]}
                />
              )}

              {tests[selectedProvider] && (
                <div
                  className={cn(
                    styles.testResult,
                    providerIsHealthy(tests[selectedProvider]) &&
                      styles.testResultGood
                  )}
                >
                  {providerIsHealthy(tests[selectedProvider]) ? (
                    <CheckCircle2 aria-hidden="true" size={17} />
                  ) : (
                    <AlertCircle aria-hidden="true" size={17} />
                  )}
                  <div>
                    <strong>
                      {providerIsHealthy(tests[selectedProvider])
                        ? "连接测试通过"
                        : "连接测试失败"}
                    </strong>
                    <span>
                      {tests[selectedProvider]?.message ?? "提供商已响应"}
                      {tests[selectedProvider]?.latencyMs
                        ? ` · ${tests[selectedProvider]?.latencyMs} ms`
                        : ""}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "delivery" && (
          <section className={styles.tabPanel}>
            <SectionTitle
              description="统一图片访问域名和路径格式，保存后应用于新生成链接。"
              eyebrow="DELIVERY"
              icon={Globe2}
              title="域名与链接"
              action={
                <Button
                  disabled={busy === "save-delivery"}
                  onClick={() => void saveSettings("delivery")}
                  size="compact"
                >
                  {busy === "save-delivery" ? (
                    <LoaderCircle className={styles.spin} size={16} />
                  ) : (
                    <Save aria-hidden="true" size={16} />
                  )}
                  保存设置
                </Button>
              }
            />
            <div className={styles.twoColumn}>
              <div className={styles.settingsCard}>
                <div className={styles.cardLabel}>
                  <Globe2 aria-hidden="true" size={17} />
                  <div>
                    <strong>访问域名</strong>
                    <small>可填写 CDN 或反向代理域名</small>
                  </div>
                </div>
                <div className={styles.fieldStack}>
                  <Field
                    hint="留空时使用当前站点地址。"
                    label="自定义域名"
                    wide
                  >
                    <input
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          delivery: {
                            ...current.delivery,
                            customDomain: event.target.value
                          }
                        }))
                      }
                      placeholder="https://img.example.com"
                      value={settings.delivery.customDomain}
                    />
                  </Field>
                  <Field
                    hint="必须包含 {id}，并包含 {variant} 或 {path}；可选 {domain}。"
                    label="链接模板"
                    wide
                  >
                    <input
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          delivery: {
                            ...current.delivery,
                            linkTemplate: event.target.value
                          }
                        }))
                      }
                      value={settings.delivery.linkTemplate}
                    />
                  </Field>
                </div>
              </div>

              <div className={styles.previewCard}>
                <div className={styles.previewGlow} />
                <span>LIVE PREVIEW</span>
                <h3>链接预览</h3>
                <p>上传完成后，复制面板将优先使用这个公开地址。</p>
                <div className={styles.urlPreview}>
                  <Link2 aria-hidden="true" size={16} />
                  <code>{previewUrl}</code>
                  <button aria-label="复制示例链接" onClick={() => void copyPreview()}>
                    <Copy aria-hidden="true" size={15} />
                  </button>
                </div>
                <div className={styles.previewMeta}>
                  <span>
                    <CheckCircle2 size={14} />
                    HTTPS 推荐
                  </span>
                  <span>
                    <Sparkles size={14} />
                    自动套用变量
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "hotlink" && (
          <section className={styles.tabPanel}>
            <SectionTitle
              description="限制图片被第三方站点直接引用，并为临时访问添加签名。"
              eyebrow="ACCESS CONTROL"
              icon={ShieldCheck}
              title="防盗链与签名"
              action={
                <Button
                  disabled={busy === "save-delivery"}
                  onClick={() => void saveSettings("delivery")}
                  size="compact"
                >
                  {busy === "save-delivery" ? (
                    <LoaderCircle className={styles.spin} size={16} />
                  ) : (
                    <Save aria-hidden="true" size={16} />
                  )}
                  保存策略
                </Button>
              }
            />
            <div className={styles.securityGrid}>
              <div className={styles.settingsCard}>
                <div className={styles.switchRow}>
                  <span className={styles.switchIcon}>
                    <ShieldCheck aria-hidden="true" size={18} />
                  </span>
                  <div>
                    <strong>Referer 防盗链</strong>
                    <small>仅允许白名单站点直接加载图片</small>
                  </div>
                  <Toggle
                    checked={settings.delivery.hotlinkEnabled}
                    label="启用 Referer 防盗链"
                    onChange={(value) =>
                      setSettings((current) => ({
                        ...current,
                        delivery: {
                          ...current.delivery,
                          hotlinkEnabled: value
                        }
                      }))
                    }
                  />
                </div>
                <div className={styles.refererEditor}>
                  <label>
                    <span>允许的 Referer</span>
                    <div>
                      <input
                        disabled={!settings.delivery.hotlinkEnabled}
                        onChange={(event) => setRefererInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addReferer();
                          }
                        }}
                        placeholder="https://example.com"
                        value={refererInput}
                      />
                      <Button
                        disabled={!settings.delivery.hotlinkEnabled || !refererInput.trim()}
                        onClick={addReferer}
                        size="compact"
                        variant="secondary"
                      >
                        <Plus aria-hidden="true" size={15} />
                        添加
                      </Button>
                    </div>
                  </label>
                  <div className={styles.refererList}>
                    {settings.delivery.allowedReferers.length ? (
                      settings.delivery.allowedReferers.map((referer) => (
                        <span key={referer}>
                          <Globe2 aria-hidden="true" size={13} />
                          {referer}
                          <button
                            aria-label={`移除 ${referer}`}
                            onClick={() => removeReferer(referer)}
                            type="button"
                          >
                            <X aria-hidden="true" size={13} />
                          </button>
                        </span>
                      ))
                    ) : (
                      <p>尚未添加白名单，启用后请至少添加一个站点。</p>
                    )}
                  </div>
                  <div className={styles.inlineOption}>
                    <div>
                      <strong>允许空 Referer</strong>
                      <small>兼容浏览器直接访问和隐私模式</small>
                    </div>
                    <Toggle
                      checked={settings.delivery.allowEmptyReferer}
                      label="允许空 Referer"
                      onChange={(value) =>
                        setSettings((current) => ({
                          ...current,
                          delivery: {
                            ...current.delivery,
                            allowEmptyReferer: value
                          }
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              <div className={styles.settingsCard}>
                <div className={styles.switchRow}>
                  <span className={styles.switchIcon}>
                    <LockKeyhole aria-hidden="true" size={18} />
                  </span>
                  <div>
                    <strong>签名 URL</strong>
                    <small>让链接在指定时间后自动失效</small>
                  </div>
                  <Toggle
                    checked={settings.delivery.signedUrls}
                    label="启用签名 URL"
                    onChange={(value) =>
                      setSettings((current) => ({
                        ...current,
                        delivery: {
                          ...current.delivery,
                          signedUrls: value
                        }
                      }))
                    }
                  />
                </div>
                <div className={styles.signedBody}>
                  <Field hint="范围 60 秒至 7 天。" label="默认有效期" wide>
                    <div className={styles.numberWithUnit}>
                      <input
                        disabled={!settings.delivery.signedUrls}
                        max={604800}
                        min={60}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            delivery: {
                              ...current.delivery,
                              signedUrlTtlSeconds:
                                Number(event.target.value) || 60
                            }
                          }))
                        }
                        type="number"
                        value={settings.delivery.signedUrlTtlSeconds}
                      />
                      <span>秒</span>
                    </div>
                  </Field>
                  <div className={styles.securityNote}>
                    <KeyRound aria-hidden="true" size={17} />
                    <div>
                      <strong>密钥由服务端管理</strong>
                      <p>
                        签名参数不会暴露内部凭据；公开链接仍可按分享规则单独控制。
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "migrations" && (
          <section className={styles.tabPanel}>
            <SectionTitle
              description="在不同提供商间复制原图与派生文件，过程可随时查看。"
              eyebrow="MIGRATIONS"
              icon={History}
              title="数据迁移"
              action={
                <Button onClick={() => setMigrationDialog(true)} size="compact">
                  <Plus aria-hidden="true" size={16} />
                  新建迁移
                </Button>
              }
            />
            <div className={styles.migrationGuide}>
              <div>
                <span className={styles.guideNode}>
                  {(() => {
                    const Icon = providerMeta.local.icon;
                    return <Icon aria-hidden="true" size={19} />;
                  })()}
                </span>
                <strong>{providerMeta.local.label}</strong>
                <small>当前来源</small>
              </div>
              <span className={styles.guideLine}>
                <ArrowRight aria-hidden="true" size={17} />
              </span>
              <div>
                <span className={styles.guideNode}>
                  <Cloud aria-hidden="true" size={19} />
                </span>
                <strong>目标提供商</strong>
                <small>校验后复制</small>
              </div>
              <p>
                迁移期间上传不受影响。当前版本继续使用本地存储作为写入源。
              </p>
            </div>
            <div className={styles.listCard}>
              <div className={styles.listHead}>
                <div>
                  <strong>迁移记录</strong>
                  <span>{migrations.length} 个任务</span>
                </div>
                <Button onClick={() => void loadAll()} size="compact" variant="ghost">
                  <RefreshCw aria-hidden="true" size={15} />
                  刷新
                </Button>
              </div>
              {migrations.length ? (
                <div className={styles.migrationList}>
                  {migrations.map((migration) => {
                    const progress = migrationProgress(migration);
                    return (
                      <article key={migration.id}>
                        <div className={styles.migrationRoute}>
                          <span>
                            {providerMeta[migration.source]?.label ?? migration.source}
                          </span>
                          <ChevronRight aria-hidden="true" size={14} />
                          <strong>
                            {providerMeta[migration.target]?.label ?? migration.target}
                          </strong>
                        </div>
                        <MigrationBadge status={migration.status} />
                        <div className={styles.progressMeta}>
                          <span>
                            {migration.completed} / {migration.total || "—"} 个对象
                          </span>
                          <strong>{progress}%</strong>
                        </div>
                        <div className={styles.progressTrack}>
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        <div className={styles.rowMeta}>
                          <span>{formatDate(migration.createdAt)}</span>
                          {!!migration.failed && (
                            <span className={styles.failed}>
                              {migration.failed} 个失败
                            </span>
                          )}
                        </div>
                        {migration.error && (
                          <p className={styles.itemError}>{migration.error}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  description="创建任务后，复制与校验进度会显示在这里。"
                  icon={History}
                  title="还没有迁移记录"
                />
              )}
            </div>
          </section>
        )}

        {activeTab === "backups" && (
          <section className={styles.tabPanel}>
            <SectionTitle
              description="创建可下载的完整备份，并设置自动保留策略。"
              eyebrow="BACKUP & RESTORE"
              icon={FileArchive}
              title="备份与恢复"
              action={
                <Button
                  disabled={busy === "backup-create"}
                  onClick={() => void createBackup()}
                  size="compact"
                >
                  {busy === "backup-create" ? (
                    <LoaderCircle className={styles.spin} size={16} />
                  ) : (
                    <Plus aria-hidden="true" size={16} />
                  )}
                  立即备份
                </Button>
              }
            />
            <div className={styles.backupLayout}>
              <aside className={styles.scheduleCard}>
                <div className={styles.switchRow}>
                  <span className={styles.switchIcon}>
                    <RefreshCw aria-hidden="true" size={18} />
                  </span>
                  <div>
                    <strong>自动备份</strong>
                    <small>按固定间隔创建快照</small>
                  </div>
                  <Toggle
                    checked={settings.backup.scheduleEnabled}
                    label="启用自动备份"
                    onChange={(value) =>
                      setSettings((current) => ({
                        ...current,
                        backup: { ...current.backup, scheduleEnabled: value }
                      }))
                    }
                  />
                </div>
                <div className={styles.scheduleFields}>
                  <Field label="执行间隔" wide>
                    <div className={styles.numberWithUnit}>
                      <input
                        disabled={!settings.backup.scheduleEnabled}
                        min={1}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            backup: {
                              ...current.backup,
                              intervalHours: Number(event.target.value) || 1
                            }
                          }))
                        }
                        type="number"
                        value={settings.backup.intervalHours}
                      />
                      <span>小时</span>
                    </div>
                  </Field>
                  <Field label="保留数量" wide>
                    <div className={styles.numberWithUnit}>
                      <input
                        disabled={!settings.backup.scheduleEnabled}
                        min={1}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            backup: {
                              ...current.backup,
                              retentionCount: Number(event.target.value) || 1
                            }
                          }))
                        }
                        type="number"
                        value={settings.backup.retentionCount}
                      />
                      <span>份</span>
                    </div>
                  </Field>
                </div>
                <div className={styles.scheduleSummary}>
                  <span>上次自动备份</span>
                  <strong>{formatDate(settings.backup.lastBackupAt)}</strong>
                </div>
                <Button
                  disabled={busy === "save-backup"}
                  onClick={() => void saveSettings("backup")}
                  variant="secondary"
                >
                  {busy === "save-backup" ? (
                    <LoaderCircle className={styles.spin} size={16} />
                  ) : (
                    <Save aria-hidden="true" size={16} />
                  )}
                  保存备份计划
                </Button>
              </aside>
              <div className={styles.listCard}>
                <div className={styles.listHead}>
                  <div>
                    <strong>备份记录</strong>
                    <span>{backups.length} 个快照</span>
                  </div>
                  <Button onClick={() => void loadAll()} size="compact" variant="ghost">
                    <RefreshCw aria-hidden="true" size={15} />
                    刷新
                  </Button>
                </div>
                {backups.length ? (
                  <div className={styles.backupList}>
                    {backups.map((backup) => (
                      <article key={backup.id}>
                        <span className={styles.backupIcon}>
                          <FileArchive aria-hidden="true" size={19} />
                        </span>
                        <div className={styles.backupCopy}>
                          <div>
                            <strong>{formatDate(backup.createdAt)}</strong>
                            <BackupBadge status={backup.status} />
                          </div>
                          <span>
                            {formatBytes(backup.size)}
                            {` · ${backup.fileCount} 个文件`}
                          </span>
                          {backup.error && (
                            <span className={styles.itemError}>{backup.error}</span>
                          )}
                        </div>
                        <div className={styles.backupActions}>
                          {backup.status === "completed" && (
                            <>
                              <Button asChild size="icon" variant="ghost">
                                <a
                                  aria-label="下载备份"
                                  href={`/api/backups/${backup.id}/download`}
                                >
                                  <Download aria-hidden="true" size={16} />
                                </a>
                              </Button>
                              <Button
                                aria-label="恢复备份"
                                onClick={() => setPendingRestore(backup)}
                                size="icon"
                                variant="ghost"
                              >
                                <ArchiveRestore aria-hidden="true" size={16} />
                              </Button>
                            </>
                          )}
                          <Button
                            aria-label="删除备份"
                            onClick={() => setPendingDelete(backup)}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    description="手动创建或启用计划后，备份会列在这里。"
                    icon={FileArchive}
                    title="还没有备份"
                  />
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <ConfirmDialog
        busy={busy === "backup-restore"}
        confirmLabel="确认恢复"
        description="恢复会替换当前配置与图片索引。系统会先保护当前状态，再执行恢复。"
        icon={ArchiveRestore}
        onConfirm={() => void restoreBackup()}
        onOpenChange={(open) => !open && setPendingRestore(null)}
        open={Boolean(pendingRestore)}
        title="从这个备份恢复？"
      />
      <ConfirmDialog
        busy={busy === "backup-delete"}
        confirmLabel="永久删除"
        danger
        description="删除后无法下载或用于恢复，这个操作不能撤销。"
        icon={Trash2}
        onConfirm={() => void deleteBackup()}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        open={Boolean(pendingDelete)}
        title="删除这个备份？"
      />

      <Dialog.Root onOpenChange={setMigrationDialog} open={migrationDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
          <Dialog.Content className={cn(styles.dialog, styles.migrationDialog)}>
            <div className={styles.dialogIcon}>
              <History aria-hidden="true" size={22} />
            </div>
            <Dialog.Title>新建迁移任务</Dialog.Title>
            <Dialog.Description>
              选择目标存储。任务会复制并校验文件，不会删除来源数据。
            </Dialog.Description>
            <div className={styles.migrationChoice}>
              <span>来源</span>
              <strong>{providerMeta.local.label}</strong>
              <ArrowRight aria-hidden="true" size={16} />
              <label>
                <span>目标</span>
                <select
                  onChange={(event) =>
                    setMigrationTarget(event.target.value as ProviderKey)
                  }
                  value={migrationTarget}
                >
                  {(Object.keys(providerMeta) as ProviderKey[])
                    .filter((provider) => provider !== "local")
                    .map((provider) => (
                      <option key={provider} value={provider}>
                        {providerMeta[provider].label}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className={styles.dialogActions}>
              <Button
                disabled={busy === "migration"}
                onClick={() => setMigrationDialog(false)}
                variant="secondary"
              >
                取消
              </Button>
              <Button
                disabled={busy === "migration"}
                onClick={() => void createMigration()}
              >
                {busy === "migration" && (
                  <LoaderCircle className={styles.spin} size={16} />
                )}
                开始迁移
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </AppShell>
  );
}

function RemoteProviderFields({
  provider,
  config,
  secret,
  onChange,
  onSecretChange
}: {
  provider: "s3" | "r2";
  config: RemoteProviderConfig;
  secret: string;
  onChange: (key: keyof RemoteProviderConfig, value: string | boolean) => void;
  onSecretChange: (value: string) => void;
}) {
  return (
    <div className={styles.fieldGrid}>
      <Field hint="对象存储的 HTTPS API 地址。" label="Endpoint" wide>
        <input
          onChange={(event) => onChange("endpoint", event.target.value)}
          placeholder={
            provider === "r2"
              ? "https://<account-id>.r2.cloudflarestorage.com"
              : "https://s3.amazonaws.com"
          }
          value={config.endpoint}
        />
      </Field>
      <Field label="Region">
        <input
          onChange={(event) => onChange("region", event.target.value)}
          placeholder={provider === "r2" ? "auto" : "ap-east-1"}
          value={config.region}
        />
      </Field>
      <Field label="Bucket">
        <input
          onChange={(event) => onChange("bucket", event.target.value)}
          placeholder="ou-image-assets"
          value={config.bucket}
        />
      </Field>
      <Field label="Access Key ID">
        <input
          autoComplete="off"
          onChange={(event) => onChange("accessKeyId", event.target.value)}
          value={config.accessKeyId}
        />
      </Field>
      <Field
        hint={
          config.secretConfigured
            ? "已安全保存；留空将继续使用原密钥。"
            : "只在保存时发送，服务端不会回显。"
        }
        label="Secret Access Key"
      >
        <input
          autoComplete="new-password"
          onChange={(event) => onSecretChange(event.target.value)}
          placeholder={config.secretConfigured ? "••••••••••••••••" : "输入密钥"}
          type="password"
          value={secret}
        />
      </Field>
      <Field hint="可选，用于公开图片链接。" label="Public Base URL" wide>
        <input
          onChange={(event) => onChange("publicBaseUrl", event.target.value)}
          placeholder="https://cdn.example.com"
          value={config.publicBaseUrl}
        />
      </Field>
      <div className={cn(styles.inlineOption, styles.fieldWide)}>
        <div>
          <strong>Path-style 访问</strong>
          <small>兼容 MinIO 等需要 bucket 路径的服务</small>
        </div>
        <Toggle
          checked={config.pathStyle}
          label="使用 Path-style 访问"
          onChange={(value) => onChange("pathStyle", value)}
        />
      </div>
    </div>
  );
}

function MigrationBadge({ status }: { status: Migration["status"] }) {
  const copy = {
    running: ["迁移中", "info"],
    completed: ["已完成", "success"],
    failed: ["失败", "warning"]
  } as const;
  return <Badge tone={copy[status][1]}>{copy[status][0]}</Badge>;
}

function BackupBadge({ status }: { status: Backup["status"] }) {
  const copy = {
    running: ["备份中", "info"],
    completed: ["可恢复", "success"],
    failed: ["失败", "warning"]
  } as const;
  return <Badge tone={copy[status][1]}>{copy[status][0]}</Badge>;
}

function EmptyState({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.empty}>
      <span>
        <Icon aria-hidden="true" size={23} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
