"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  canAccessNavigationItem,
  navigationItems,
  type NavigationItem,
  type WorkspaceRole as SharedWorkspaceRole
} from "@ou-image/shared";
import { Button, cn } from "@ou-image/ui";
import {
  Activity,
  Album,
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  Command,
  FileImage,
  FolderHeart,
  Globe2,
  Heart,
  ImageUp,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Search,
  ServerCog,
  Settings,
  Sun,
  Tags,
  Trash2,
  Upload,
  Users,
  WifiOff,
  X,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  getNotifications,
  markAllNotificationsRead,
  type NotificationItem
} from "@/lib/admin-api";
import {
  apiRequest,
  getStoredWorkspaceId,
  normalizeSessionBootstrap,
  setStoredWorkspaceId,
  type SessionUser,
  type WorkspaceRole,
  type WorkspaceSummary
} from "@/lib/api";
import {
  clearShellSessionSnapshot,
  readShellSessionSnapshot,
  switchShellSessionWorkspace,
  writeShellSessionSnapshot
} from "@/lib/shell-session-cache";
import {
  DEFAULT_SITE_BRANDING,
  bindSiteAppearance,
  normalizeSiteBranding,
  storedThemePreference,
  useFallbackLogo,
  type SiteBranding
} from "@/lib/site-branding";

const iconMap: Record<string, LucideIcon> = {
  overview: Activity,
  upload: Upload,
  library: FileImage,
  albums: Album,
  tags: Tags,
  favorites: Heart,
  trash: Trash2,
  storage: FolderHeart,
  analytics: ChartNoAxesCombined,
  team: Users,
  users: Users,
  tokens: KeyRound,
  audit: Activity,
  system: ServerCog,
  settings: Settings
};

const applicationNavigationItems: NavigationItem[] = [
  ...navigationItems,
  {
    key: "system",
    label: "系统状态",
    href: "/system",
    group: "system",
    access: "site-owner"
  }
];

function filterApplicationNavigation(access: {
  workspaceRole: SharedWorkspaceRole;
  siteRole: SessionUser["role"];
}) {
  return applicationNavigationItems.filter((item) =>
    canAccessNavigationItem(item, access)
  );
}

const mobileKeys = ["overview", "library", "upload", "albums", "settings"];

function formatStorage(value: number) {
  if (value < 1024 * 1024) return `${Math.max(0, value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const notificationCategoryCopy = {
  security: "安全",
  collaboration: "协作",
  system: "系统"
} as const;

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Brand({
  compact = false,
  site
}: {
  compact?: boolean;
  site: SiteBranding;
}) {
  return (
    <Link className={cn("brand", compact && "brand--compact")} href="/">
      <span className="brand__logo-frame">
        <img
          alt={`${site.siteName} Logo`}
          className="brand__logo"
          height={48}
          onError={(event) => useFallbackLogo(event.currentTarget)}
          src={site.siteLogoUrl}
          width={48}
        />
      </span>
      {!compact && (
        <span className="brand__text">
          <strong>{site.siteName}</strong>
          <small>
            {site.siteDescription || DEFAULT_SITE_BRANDING.siteDescription}
          </small>
        </span>
      )}
    </Link>
  );
}

function Navigation({
  activeKey,
  items,
  onNavigate
}: {
  activeKey: string;
  items: NavigationItem[];
  onNavigate?: () => void;
}) {
  const groups = [
    { key: "workspace", label: "工作区" },
    { key: "manage", label: "管理" },
    { key: "system", label: "系统" }
  ] as const;

  return (
    <nav aria-label="主导航" className="sidebar-nav">
      {groups.map((group) => {
        const groupItems = items.filter((item) => item.group === group.key);
        if (groupItems.length === 0) return null;
        return (
          <div className="sidebar-nav__group" key={group.key}>
            <span className="sidebar-nav__label">{group.label}</span>
            {groupItems.map((item) => {
              const Icon = iconMap[item.key] ?? FileImage;
              return (
                <Link
                  aria-current={activeKey === item.key ? "page" : undefined}
                  className={cn(
                    "sidebar-nav__item",
                    activeKey === item.key && "is-active"
                  )}
                  href={item.href}
                  key={item.key}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

const roleCopy: Record<WorkspaceRole, string> = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "只读"
};

function WorkspaceSwitcher({
  current,
  workspaces,
  onChange,
  compact = false
}: {
  current: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  onChange: (workspace: WorkspaceSummary) => void;
  compact?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label="切换工作区"
          className={cn("workspace-switcher", compact && "workspace-switcher--mobile")}
          type="button"
        >
          <span className="workspace-switcher__avatar">
            {(current?.name ?? "OU").slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{current?.name ?? "正在读取工作区"}</strong>
            <small>
              {current ? roleCopy[current.role] : "安全工作区"}
            </small>
          </span>
          <ChevronDown aria-hidden="true" size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={compact ? "start" : "center"}
          className="workspace-menu"
          sideOffset={8}
        >
          <div className="workspace-menu__head">
            <strong>切换工作区</strong>
            <span>权限会随工作区自动更新</span>
          </div>
          <DropdownMenu.Separator className="dropdown-separator" />
          {workspaces.map((workspace) => (
            <DropdownMenu.Item
              className="workspace-menu__item"
              key={workspace.id}
              onSelect={() => onChange(workspace)}
            >
              <span className="workspace-menu__avatar">
                {workspace.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{workspace.name}</strong>
                <small>{roleCopy[workspace.role]}</small>
              </span>
              {current?.id === workspace.id && (
                <span className="workspace-menu__current">当前</span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function IconTooltip({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip-content" sideOffset={8}>
          {label}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function AppShell({
  activeKey,
  children
}: {
  activeKey: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const cachedSession = useMemo(() => readShellSessionSnapshot(), []);
  const hasCachedShell = Boolean(
    cachedSession?.user && cachedSession.currentWorkspace
  );
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [siteBranding, setSiteBranding] = useState<SiteBranding>(
    DEFAULT_SITE_BRANDING
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationQuiet, setNotificationQuiet] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [accessChecked, setAccessChecked] = useState(hasCachedShell);
  const [query, setQuery] = useState("");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(
    cachedSession?.user ?? null
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(
    cachedSession?.workspaces ?? []
  );
  const [currentWorkspace, setCurrentWorkspace] =
    useState<WorkspaceSummary | null>(
      cachedSession?.currentWorkspace ?? null
    );
  const [storageSummary, setStorageSummary] = useState<{
    bytes: number;
    quotaBytes: number;
  } | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!getStoredWorkspaceId()) return;
    setNotificationLoading(true);
    setNotificationError("");
    try {
      const payload = await getNotifications(20);
      setNotifications(payload.notifications);
      setNotificationUnreadCount(payload.unreadCount);
      setNotificationQuiet(payload.badgeSuppressed);
    } catch {
      setNotificationError("通知加载失败，请稍后重试。");
    } finally {
      setNotificationLoading(false);
    }
  }, []);

  const changeNotificationsOpen = (open: boolean) => {
    setNotificationsOpen(open);
    if (open) void loadNotifications();
  };

  const markNotificationsRead = async () => {
    setNotificationBusy(true);
    setNotificationError("");
    try {
      const payload = await markAllNotificationsRead();
      const readIds = new Set(payload.readEventIds);
      setNotifications((current) =>
        current.map((notification) => ({
          ...notification,
          read: notification.read || readIds.has(notification.id)
        }))
      );
      setNotificationUnreadCount(payload.unreadCount);
    } catch {
      setNotificationError("通知状态更新失败，请稍后重试。");
    } finally {
      setNotificationBusy(false);
    }
  };

  useEffect(() => {
    const explicit = storedThemePreference(
      window.localStorage.getItem("ou-theme")
    );
    return bindSiteAppearance(siteBranding, explicit, setTheme);
  }, [siteBranding]);

  useEffect(() => {
    let active = true;
    apiRequest<{ site?: unknown }>("/setup/status")
      .then((payload) => {
        if (active && payload.site) {
          setSiteBranding(normalizeSiteBranding(payload.site));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const updateConnection = () => setOnline(window.navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    apiRequest<{
      user: SessionUser;
      workspaces?: WorkspaceSummary[];
      defaultWorkspace?: WorkspaceSummary;
      backoffice?: import("@/lib/api").BackofficeAccess;
    }>("/auth/session")
      .then((payload) => {
        const bootstrap = normalizeSessionBootstrap(payload);
        if (!bootstrap.backoffice.allowed) {
          clearShellSessionSnapshot();
          router.replace("/?backoffice=denied");
          return;
        }
        const backofficeWorkspaces = bootstrap.backoffice.workspaceId
          ? bootstrap.workspaces.filter(
              (workspace) => workspace.id === bootstrap.backoffice.workspaceId
            )
          : [bootstrap.defaultWorkspace];
        const storedId = getStoredWorkspaceId();
        const selected =
          backofficeWorkspaces.find((workspace) => workspace.id === storedId) ??
          backofficeWorkspaces[0] ??
          bootstrap.defaultWorkspace;
        setStoredWorkspaceId(selected.id);
        setSessionUser(bootstrap.user);
        setWorkspaces(backofficeWorkspaces);
        setCurrentWorkspace(selected);
        setAccessChecked(true);
        writeShellSessionSnapshot(bootstrap, selected.id);
        void apiRequest<{ bytes: number; quotaBytes: number }>(
          "/uploads/summary"
        )
          .then(setStorageSummary)
          .catch(() => setStorageSummary(null));
      })
      .catch(() => {
        clearShellSessionSnapshot();
        router.replace("/login");
      });
  }, [router]);

  useEffect(() => {
    if (sessionUser && currentWorkspace) {
      void loadNotifications();
    }
  }, [currentWorkspace, loadNotifications, sessionUser]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const visibleItems = useMemo(
    () => {
      if (!sessionUser || !currentWorkspace) {
        return applicationNavigationItems.filter(
          (item) => (item.access ?? "all") === "all"
        );
      }
      return filterApplicationNavigation({
        workspaceRole: currentWorkspace.role as SharedWorkspaceRole,
        siteRole: sessionUser.role
      });
    },
    [currentWorkspace, sessionUser]
  );

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return visibleItems;
    return visibleItems.filter((item) =>
      `${item.label} ${item.key}`.toLowerCase().includes(normalized)
    );
  }, [query, visibleItems]);
  const hasUnreadNotifications = notifications.some(
    (notification) => !notification.read
  );

  const changeWorkspace = (workspace: WorkspaceSummary) => {
    if (workspace.id === currentWorkspace?.id) return;
    const nextItems = sessionUser
      ? filterApplicationNavigation({
          workspaceRole: workspace.role as SharedWorkspaceRole,
          siteRole: sessionUser.role
        })
      : [];
    const destination = nextItems.some((item) => item.key === activeKey)
      ? pathname
      : (nextItems.find((item) => item.key === "library")?.href ??
        nextItems[0]?.href ??
        "/");
    setStoredWorkspaceId(workspace.id);
    setCurrentWorkspace(workspace);
    switchShellSessionWorkspace(workspace);
    window.location.assign(destination);
  };

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    window.localStorage.setItem("ou-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  };

  if (!accessChecked) {
    return (
      <div aria-live="polite" className="app-access-loading" role="status">
        正在确认后台访问权限…
      </div>
    );
  }

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className={cn("app-shell", !online && "app-shell--offline")}>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <aside className="sidebar">
          <div className="sidebar__brand">
            <Brand site={siteBranding} />
          </div>
          <WorkspaceSwitcher
            current={currentWorkspace}
            onChange={changeWorkspace}
            workspaces={workspaces}
          />
          <Navigation activeKey={activeKey} items={visibleItems} />
          {sessionUser?.role === "owner" && (
            <div className="sidebar__storage">
            <div>
              <span>存储空间</span>
              <strong>
                {storageSummary
                  ? `${formatStorage(storageSummary.bytes)} / ${formatStorage(storageSummary.quotaBytes)}`
                  : "读取中"}
              </strong>
            </div>
            <div className="storage-track" aria-hidden="true">
              <span
                style={{
                  width: storageSummary
                    ? `${Math.min(
                        100,
                        (storageSummary.bytes / storageSummary.quotaBytes) * 100
                      )}%`
                    : "0%"
                }}
              />
            </div>
            <Link href="/storage">本地存储运行中</Link>
            </div>
          )}
        </aside>

        <header className="topbar">
          <div className="topbar__mobile-brand">
            <Dialog.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <Dialog.Trigger asChild>
                <button
                  aria-label="打开导航"
                  className="icon-button"
                  type="button"
                >
                  <Menu aria-hidden="true" size={20} />
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content
                  aria-describedby={undefined}
                  className="mobile-drawer"
                >
                  <Dialog.Title className="sr-only">主导航</Dialog.Title>
                  <div className="mobile-drawer__head">
                    <Brand site={siteBranding} />
                    <Dialog.Close asChild>
                      <button
                        aria-label="关闭导航"
                        className="icon-button"
                        type="button"
                      >
                        <X aria-hidden="true" size={20} />
                      </button>
                    </Dialog.Close>
                  </div>
                  <WorkspaceSwitcher
                    compact
                    current={currentWorkspace}
                    onChange={changeWorkspace}
                    workspaces={workspaces}
                  />
                  <Navigation
                    activeKey={activeKey}
                    items={visibleItems}
                    onNavigate={() => setMobileMenuOpen(false)}
                  />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Brand compact site={siteBranding} />
          </div>

          <button
            className="command-trigger"
            onClick={() => setCommandOpen(true)}
            type="button"
          >
            <Search aria-hidden="true" size={17} />
            <span>搜索图片、相册、标签</span>
            <kbd>⌘ K</kbd>
          </button>

          <div className="topbar__actions">
            <Button asChild size="compact" variant="secondary">
              <Link href="/">
                <Globe2 aria-hidden="true" size={17} />
                公共图床
              </Link>
            </Button>
            {visibleItems.some((item) => item.key === "upload") && (
              <Button asChild className="quick-upload" size="compact">
                <Link href="/">
                  <ImageUp aria-hidden="true" size={17} />
                  快速上传
                </Link>
              </Button>
            )}
            <IconTooltip label={theme === "light" ? "切换深色模式" : "切换浅色模式"}>
              <button
                aria-label={theme === "light" ? "切换深色模式" : "切换浅色模式"}
                className="icon-button"
                onClick={toggleTheme}
                type="button"
              >
                {theme === "light" ? (
                  <Moon aria-hidden="true" size={18} />
                ) : (
                  <Sun aria-hidden="true" size={18} />
                )}
              </button>
            </IconTooltip>
            <Dialog.Root
              open={notificationsOpen}
              onOpenChange={changeNotificationsOpen}
            >
              <IconTooltip label="通知">
                <Dialog.Trigger asChild>
                  <button
                    aria-label="打开通知"
                    className="icon-button"
                    type="button"
                  >
                    <Bell aria-hidden="true" size={18} />
                    {notificationUnreadCount > 0 && !notificationQuiet && (
                      <span
                        aria-label={`${notificationUnreadCount} 条未读通知`}
                        className="notification-badge"
                      >
                        {notificationUnreadCount > 9
                          ? "9+"
                          : notificationUnreadCount}
                      </span>
                    )}
                  </button>
                </Dialog.Trigger>
              </IconTooltip>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content
                  aria-describedby="notification-description"
                  className="side-drawer"
                >
                  <div className="side-drawer__head">
                    <div>
                      <Dialog.Title>通知</Dialog.Title>
                      <Dialog.Description id="notification-description">
                        工作区的重要状态会显示在这里。
                      </Dialog.Description>
                    </div>
                    <div className="notification-head-actions">
                      <Button
                        disabled={
                          notificationBusy || !hasUnreadNotifications
                        }
                        onClick={() => void markNotificationsRead()}
                        size="compact"
                        variant="ghost"
                      >
                        全部标为已读
                      </Button>
                      <Dialog.Close asChild>
                        <button
                          aria-label="关闭通知"
                          className="icon-button"
                          type="button"
                        >
                          <X aria-hidden="true" size={20} />
                        </button>
                      </Dialog.Close>
                    </div>
                  </div>
                  {notificationQuiet && (
                    <div className="notification-quiet">
                      免打扰时段已启用，未读通知仍会保留在这里。
                    </div>
                  )}
                  {notificationError && (
                    <div className="notification-error" role="alert">
                      {notificationError}
                    </div>
                  )}
                  {notificationLoading && notifications.length === 0 ? (
                    <div className="drawer-empty">
                      <Bell aria-hidden="true" size={28} />
                      <strong>正在读取通知</strong>
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="drawer-empty">
                      <Bell aria-hidden="true" size={28} />
                      <strong>暂无通知</strong>
                      <p>新的安全、协作和系统事件会出现在这里。</p>
                    </div>
                  ) : (
                    <div className="notification-list">
                      {notifications.map((notification) => (
                        <article
                          className={cn(
                            "notification-item",
                            !notification.read && "is-unread"
                          )}
                          key={notification.id}
                        >
                          <span className="notification-item__dot" />
                          <div>
                            <span>
                              {notificationCategoryCopy[notification.category]}
                            </span>
                            <strong>{notification.action}</strong>
                            <time dateTime={notification.createdAt}>
                              {formatNotificationTime(notification.createdAt)}
                            </time>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  aria-label="打开用户菜单"
                  className="user-trigger"
                  type="button"
                >
                  <span>
                    {(sessionUser?.displayName ?? "OU")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <ChevronDown aria-hidden="true" size={15} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  className="dropdown-content"
                  sideOffset={8}
                >
                  <div className="dropdown-profile">
                    <strong>{sessionUser?.displayName ?? "正在读取账号"}</strong>
                    <span>{sessionUser?.email ?? "安全会话"}</span>
                    {currentWorkspace && (
                      <small>
                        {currentWorkspace.name} · {roleCopy[currentWorkspace.role]}
                      </small>
                    )}
                  </div>
                  <DropdownMenu.Separator className="dropdown-separator" />
                  <DropdownMenu.Item asChild>
                    <Link className="dropdown-item" href="/settings">
                      <Settings aria-hidden="true" size={16} />
                      个人设置
                    </Link>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="dropdown-separator" />
                  <DropdownMenu.Item
                    className="dropdown-item dropdown-item--danger"
                    onSelect={(event) => {
                      event.preventDefault();
                      clearShellSessionSnapshot();
                      apiRequest("/auth/logout", { method: "POST" }).finally(() => {
                        router.replace("/login");
                        router.refresh();
                      });
                    }}
                  >
                    <LogOut aria-hidden="true" size={16} />
                    退出登录
                  </DropdownMenu.Item>
                  {visibleItems.some((item) => item.key === "audit") && (
                    <DropdownMenu.Item asChild>
                      <Link className="dropdown-item" href="/audit">
                        <Activity aria-hidden="true" size={16} />
                        活动记录
                      </Link>
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        {!online && (
          <div aria-live="polite" className="offline-banner" role="status">
            <WifiOff aria-hidden="true" size={16} />
            <strong>当前处于离线状态</strong>
            <span>浏览器恢复联网后，请重新提交尚未完成的操作。</span>
          </div>
        )}

        <div className="app-content" id="main-content" tabIndex={-1}>
          {currentWorkspace ? (
            children
          ) : (
            <div
              aria-live="polite"
              className="workspace-page"
              role="status"
            >
              正在载入安全工作区…
            </div>
          )}
        </div>

        <nav aria-label="移动端导航" className="mobile-bottom-nav">
          {visibleItems
            .filter((item) => mobileKeys.includes(item.key))
            .map((item) => {
              const Icon =
                item.key === "upload"
                  ? ImageUp
                  : (iconMap[item.key] ?? FileImage);
              const isActive =
                item.href === "/" ? pathname === "/" : pathname === item.href;
              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "mobile-bottom-nav__item",
                    isActive && "is-active",
                    item.key === "upload" && "is-upload"
                  )}
                  href={item.href}
                  key={item.key}
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={1.9} />
                  <span>{item.label === "设置中心" ? "我的" : item.label}</span>
                </Link>
              );
            })}
        </nav>

        <Dialog.Root open={commandOpen} onOpenChange={setCommandOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
            <Dialog.Content
              aria-describedby="command-description"
              className="command-dialog"
            >
              <Dialog.Title className="sr-only">命令面板</Dialog.Title>
              <Dialog.Description className="sr-only" id="command-description">
                搜索并打开工作区页面。
              </Dialog.Description>
              <div className="command-dialog__search">
                <Search aria-hidden="true" size={19} />
                <input
                  aria-label="搜索页面"
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入页面名称或操作"
                  value={query}
                />
                <kbd>Esc</kbd>
              </div>
              <div className="command-dialog__list">
                {filteredItems.map((item) => {
                  const Icon = iconMap[item.key] ?? FileImage;
                  return (
                    <Dialog.Close asChild key={item.key}>
                      <Link className="command-item" href={item.href}>
                        <span className="command-item__icon">
                          <Icon aria-hidden="true" size={17} />
                        </span>
                        <span>{item.label}</span>
                        <Command aria-hidden="true" size={14} />
                      </Link>
                    </Dialog.Close>
                  );
                })}
                {filteredItems.length === 0 && (
                  <div className="command-empty">没有找到匹配页面。</div>
                )}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </Tooltip.Provider>
  );
}
