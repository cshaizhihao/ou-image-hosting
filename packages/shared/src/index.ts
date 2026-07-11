export type NavigationItem = {
  key: string;
  label: string;
  href: string;
  group: "workspace" | "manage" | "system";
  access?: "all" | "editor" | "admin" | "site-owner";
};

export const navigationItems: NavigationItem[] = [
  { key: "overview", label: "概览", href: "/overview", group: "workspace" },
  {
    key: "upload",
    label: "上传",
    href: "/upload",
    group: "workspace",
    access: "editor"
  },
  { key: "library", label: "图片库", href: "/library", group: "workspace" },
  { key: "albums", label: "相册", href: "/albums", group: "workspace" },
  { key: "tags", label: "标签", href: "/tags", group: "workspace" },
  { key: "favorites", label: "收藏", href: "/favorites", group: "workspace" },
  {
    key: "trash",
    label: "回收站",
    href: "/trash",
    group: "workspace",
    access: "editor"
  },
  {
    key: "storage",
    label: "存储",
    href: "/storage",
    group: "manage",
    access: "site-owner"
  },
  {
    key: "analytics",
    label: "数据统计",
    href: "/analytics",
    group: "manage",
    access: "admin"
  },
  {
    key: "team",
    label: "团队",
    href: "/team",
    group: "manage",
    access: "admin"
  },
  {
    key: "tokens",
    label: "API Token",
    href: "/tokens",
    group: "manage",
    access: "admin"
  },
  {
    key: "audit",
    label: "活动与审计",
    href: "/audit",
    group: "manage",
    access: "admin"
  },
  { key: "settings", label: "设置中心", href: "/settings", group: "system" }
];

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export type SiteRole = "owner" | "member";

const roleLevel: Record<WorkspaceRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3
};

export function canAccessNavigationItem(
  item: NavigationItem,
  access: { workspaceRole: WorkspaceRole; siteRole: SiteRole }
) {
  switch (item.access ?? "all") {
    case "all":
      return true;
    case "editor":
      return roleLevel[access.workspaceRole] >= roleLevel.editor;
    case "admin":
      return roleLevel[access.workspaceRole] >= roleLevel.admin;
    case "site-owner":
      return access.siteRole === "owner";
  }
}

export function filterNavigationItems(access: {
  workspaceRole: WorkspaceRole;
  siteRole: SiteRole;
}) {
  return navigationItems.filter((item) =>
    canAccessNavigationItem(item, access)
  );
}

export const sectionContent = {
  overview: {
    title: "概览",
    description: "查看工作区状态并完成初始配置。",
    emptyTitle: "工作区已准备好",
    emptyDescription: "配置存储后，你的上传、图片和访问数据会显示在这里。"
  },
  library: {
    title: "图片库",
    description: "浏览、筛选和管理工作区中的图片。",
    emptyTitle: "图片库还是空的",
    emptyDescription: "上传第一张图片后，它会出现在这里。"
  },
  albums: {
    title: "相册",
    description: "用相册组织不同项目和主题的图片。",
    emptyTitle: "还没有相册",
    emptyDescription: "创建相册后，可以把相关图片集中管理。"
  },
  tags: {
    title: "标签",
    description: "建立可复用的图片分类体系。",
    emptyTitle: "还没有标签",
    emptyDescription: "标签会在图片上传与整理过程中逐步形成。"
  },
  favorites: {
    title: "收藏",
    description: "快速回到经常使用的重要图片。",
    emptyTitle: "还没有收藏",
    emptyDescription: "收藏的图片会集中显示在这里。"
  },
  trash: {
    title: "回收站",
    description: "恢复误删内容或执行永久删除。",
    emptyTitle: "回收站是空的",
    emptyDescription: "删除的图片会在保留期内显示在这里。"
  },
  storage: {
    title: "存储",
    description: "连接并管理图片存储位置。",
    emptyTitle: "尚未配置存储",
    emptyDescription: "后续可连接本地磁盘、S3 或 Cloudflare R2。"
  },
  analytics: {
    title: "数据统计",
    description: "了解上传、存储和访问趋势。",
    emptyTitle: "暂无统计数据",
    emptyDescription: "产生上传与访问记录后，这里会展示真实数据。"
  },
  team: {
    title: "团队",
    description: "管理工作区成员与协作权限。",
    emptyTitle: "当前只有你",
    emptyDescription: "团队功能启用后，可以邀请成员共同管理图片。"
  },
  tokens: {
    title: "API Token",
    description: "为自动化工具创建受限访问凭证。",
    emptyTitle: "还没有 API Token",
    emptyDescription: "创建 Token 后，明文只会展示一次。"
  },
  audit: {
    title: "活动与审计",
    description: "追踪重要操作和安全事件。",
    emptyTitle: "暂无活动记录",
    emptyDescription: "上传、登录和设置变更会记录在这里。"
  },
  settings: {
    title: "设置中心",
    description: "调整站点、外观和工作区偏好。",
    emptyTitle: "设置中心已准备好",
    emptyDescription: "各领域设置会随功能模块逐步启用。"
  }
} as const;
