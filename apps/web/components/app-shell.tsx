"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Tooltip from "@radix-ui/react-tooltip";
import { navigationItems } from "@ou-image/shared";
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
  Heart,
  ImageUp,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  Tags,
  Trash2,
  Upload,
  Users,
  X,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { apiRequest, type SessionUser } from "@/lib/api";

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
  tokens: KeyRound,
  audit: Activity,
  settings: Settings
};

const mobileKeys = ["overview", "library", "upload", "albums", "settings"];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={cn("brand", compact && "brand--compact")} href="/">
      <span className="brand__logo-frame">
        <img
          alt="OU-Image Hosting 官方 Logo"
          className="brand__logo"
          height={48}
          src="/brand/ou-image-hosting-logo.jpg"
          width={48}
        />
      </span>
      {!compact && (
        <span className="brand__text">
          <strong>OU-Image Hosting</strong>
          <small>欧记图床</small>
        </span>
      )}
    </Link>
  );
}

function Navigation({
  activeKey,
  onNavigate
}: {
  activeKey: string;
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
        const items = navigationItems.filter((item) => item.group === group.key);
        return (
          <div className="sidebar-nav__group" key={group.key}>
            <span className="sidebar-nav__label">{group.label}</span>
            {items.map((item) => {
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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("ou-theme");
    const preferredDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const nextTheme =
      saved === "dark" || saved === "light"
        ? saved
        : preferredDark
          ? "dark"
          : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    apiRequest<{ user: SessionUser }>("/auth/session")
      .then(({ user }) => setSessionUser(user))
      .catch(() => router.replace("/login"));
  }, [router]);

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

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return navigationItems;
    return navigationItems.filter((item) =>
      `${item.label} ${item.key}`.toLowerCase().includes(normalized)
    );
  }, [query]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    window.localStorage.setItem("ou-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  };

  return (
    <Tooltip.Provider delayDuration={350}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <Brand />
          </div>
          <div className="workspace-switcher">
            <span className="workspace-switcher__avatar">OU</span>
            <span>
              <strong>默认工作区</strong>
              <small>个人空间</small>
            </span>
            <ChevronDown aria-hidden="true" size={16} />
          </div>
          <Navigation activeKey={activeKey} />
          <div className="sidebar__storage">
            <div>
              <span>存储空间</span>
              <strong>尚未配置</strong>
            </div>
            <div className="storage-track" aria-hidden="true">
              <span />
            </div>
            <Link href="/storage">前往配置</Link>
          </div>
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
                    <Brand />
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
                  <Navigation
                    activeKey={activeKey}
                    onNavigate={() => setMobileMenuOpen(false)}
                  />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
            <Brand compact />
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
            <Button asChild className="quick-upload" size="compact">
              <Link href="/">
                <ImageUp aria-hidden="true" size={17} />
                快速上传
              </Link>
            </Button>
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
              onOpenChange={setNotificationsOpen}
            >
              <IconTooltip label="通知">
                <Dialog.Trigger asChild>
                  <button
                    aria-label="打开通知"
                    className="icon-button"
                    type="button"
                  >
                    <Bell aria-hidden="true" size={18} />
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
                  <div className="drawer-empty">
                    <Bell aria-hidden="true" size={28} />
                    <strong>暂无通知</strong>
                    <p>新的上传结果和系统状态会及时出现在这里。</p>
                  </div>
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
                      apiRequest("/auth/logout", { method: "POST" }).finally(() => {
                        router.replace("/login");
                        router.refresh();
                      });
                    }}
                  >
                    <LogOut aria-hidden="true" size={16} />
                    退出登录
                  </DropdownMenu.Item>
                  <DropdownMenu.Item asChild>
                    <Link className="dropdown-item" href="/audit">
                      <Activity aria-hidden="true" size={16} />
                      活动记录
                    </Link>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>

        <div className="app-content">{children}</div>

        <nav aria-label="移动端导航" className="mobile-bottom-nav">
          {navigationItems
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
