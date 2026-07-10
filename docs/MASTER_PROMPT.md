# OU-Image Hosting 完整开发主 Prompt

以下 Prompt 用于驱动整个项目的十轮开发。执行者必须逐轮完成，不得跳轮，不得只输出方案而不提交代码。

---

你是一名资深产品工程师、视觉设计师和 DevOps 工程师。请从零构建一个名为 **OU-Image Hosting**、中文名为 **欧记图床** 的现代自托管图床与图片资产管理平台。

## 一、项目目标

为个人创作者、开发者和小型团队提供：

- 极其顺畅的图片上传体验
- 美观、清晰、高效的图片管理体验
- 可扩展的多存储与链接策略
- 可靠的用户、权限、安全和部署能力

项目的第一优先级是：**整体必须好看。**

这里的“好看”不是堆渐变、阴影和大圆角，而是：

- 信息层级明确
- 排版克制且精致
- 组件尺寸统一
- 颜色使用有节制
- 操作反馈及时
- 移动端与桌面端都自然
- 浅色和深色模式都经过实际验证
- 空状态、加载状态、错误状态同样完整

## 二、原创性要求

这是一个独立原创项目，必须从零设计与实现。

- 不复制任何参考项目的代码、目录、组件命名、文案、截图和品牌资产。
- 不在代码、注释、提交记录、README、依赖说明中留下其他项目名称。
- 不复刻参考项目的页面布局和视觉结构。
- 所有数据库模型、API、组件和交互流程重新定义。
- 每轮结束执行全仓库关键词检查，确保没有不属于本项目的品牌痕迹。

## 三、品牌

- 英文名：OU-Image Hosting
- 中文名：欧记图床
- Logo：`docs/assets/logo/ou-image-hosting-logo.jpg`
- 品牌主张：好看、好用、好管理的现代自托管图床
- 主色：炭黑 `#303030`
- 强调色：鼻尖粉 `#EF8F8F`
- 背景色：暖白 `#F7F7F5`
- 视觉规则：读取并严格遵循 `docs/brand-guidelines.md`

Logo 必须保持比例，不得改变颜色、加阴影、加渐变、旋转或裁切主体。

## 四、技术架构

使用 pnpm workspace 建立 monorepo：

```text
apps/
  web/          Next.js + React + TypeScript
  api/          Fastify + TypeScript + OpenAPI
packages/
  ui/           OU Design System 与可访问组件
  shared/       Schema、类型、常量和工具
  config/       ESLint、TypeScript、Tailwind 配置
services/
  worker/       BullMQ + Sharp 图片处理任务
docs/
  assets/
  architecture/
  deployment/
```

基础设施：

- PostgreSQL + Drizzle ORM
- Redis + BullMQ
- Sharp
- Local / S3 / Cloudflare R2 / S3-compatible
- Vitest
- Playwright
- Docker Compose

除非有明确理由，不添加大型 UI 框架。组件使用 Radix primitives、Lucide Icons 和项目自己的设计令牌。

## 五、设计硬规则

1. 应用首屏直接是可用工作台，不制作营销 Landing Page 代替产品。
2. 桌面端使用稳定侧栏和顶栏；移动端使用顶栏与抽屉，不混用同级导航模式。
3. 主圆角 8px，弹窗和大容器最多 12px。
4. 禁止卡片套卡片，页面区块默认无悬浮卡片效果。
5. 禁止装饰性光球、Bokeh、蓝紫渐变和大面积玻璃拟态。
6. 品牌粉只用于主操作、焦点、选中和关键反馈。
7. 图标统一使用 Lucide，禁止 Emoji 作为功能图标。
8. 所有可点击区域最小 44×44px。
9. 所有图标按钮必须有 Tooltip 与 `aria-label`。
10. 所有表单必须有 Label、说明、就近错误与提交反馈。
11. 动效 160–320ms，只动画 transform 和 opacity。
12. 支持 `prefers-reduced-motion`。
13. 图片必须预留尺寸，列表必须懒加载，大数据列表必须虚拟化。
14. 375、768、1024、1440 四个宽度必须截图验证。
15. 页面不能出现横向滚动、文本溢出和遮挡。

## 六、产品核心流程

### 上传

选择文件、拖拽、粘贴和 URL 上传必须进入统一队列。

每个队列项展示：

- 缩略图
- 文件名
- 大小与尺寸
- 当前状态
- 单文件进度
- 取消与重试
- 错误原因与恢复操作

上传完成后提供：

- 复制原始 URL
- 复制 Markdown
- 复制 HTML
- 复制 BBCode
- 复制全部
- 打开图片详情

### 图片库

- 网格、瀑布流、列表三种视图
- 搜索、标签、相册、日期、上传者、存储、格式筛选
- 多选和批量操作
- 保存筛选条件、视图和滚动位置
- 点击图片打开详情 Drawer，深链接进入独立详情页

### 设置

按领域拆分为：

- 常规
- 上传与处理
- 存储
- 域名与链接
- 安全
- 用户与团队
- API Token
- 通知
- 备份与恢复

设置页必须有未保存提示、固定保存栏和危险操作区域。

## 七、版本、README 与 GitHub 规则

GitHub 仓库：

`https://github.com/cshaizhihao/ou-image-hosting`

每一轮必须：

1. 按路线图完成该轮全部目标。
2. 更新 `VERSION`。
3. 更新 `CHANGELOG.md`。
4. 更新 README：
   - 当前版本
   - 项目介绍
   - 已完成功能
   - 使用方式
   - 安装方式
   - 技术架构
   - 应用截图
   - 路线图状态
5. 应用截图必须来自真实运行页面，不能使用设计稿冒充。
6. 执行 lint、typecheck、unit、integration、E2E 和生产构建中适用于当前轮次的检查。
7. 执行原创性关键词检查。
8. Git Commit 使用 Conventional Commits。
9. 推送到 `origin/main`。
10. 输出版本号、Commit Hash、测试结果、截图路径和下一轮工作。

不得在本地完成后忘记推送。不得只更新代码而不更新 README。

## 八、十轮执行计划

### Round 1 — v0.1.0

完成品牌、Logo、仓库、主 Prompt、路线图、README、CHANGELOG、许可证和原创架构说明。

验收：

- GitHub 仓库可访问
- README 信息完整
- Logo 正确显示
- 没有其他项目痕迹

### Round 2 — v0.2.0

完成 monorepo、设计令牌、UI 基础组件、应用壳层、登录注册界面和主题切换。

必须生成：

- 桌面浅色截图
- 桌面深色截图
- 手机浅色截图
- 手机深色截图

### Round 3 — v0.3.0

完成真实上传队列、文件校验、进度、取消、重试、缩略图、元数据和链接复制。

必须测试：

- 单文件
- 20 文件批量
- 无效类型
- 超大文件
- 网络失败与恢复
- 重复文件

### Round 4 — v0.4.0

完成图片库、搜索、筛选、视图切换、多选、批量操作、虚拟化和状态保持。

### Round 5 — v0.5.0

完成图片详情、元数据、图片处理、分享链接、版本历史和回收站。

### Round 6 — v0.6.0

完成存储适配器、R2/S3、本地存储、域名、链接模板、签名 URL 和迁移任务。

### Round 7 — v0.7.0

完成用户、团队、权限、Session、API Token、审计日志和安全控制。

### Round 8 — v0.8.0

完成数据统计、活动记录、任务队列监控、健康检查、日志和导出。

### Round 9 — v0.9.0

完成设置中心、Docker、安装向导、迁移、备份恢复和完整部署文档。

### Round 10 — v1.0.0

完成视觉回归、性能、安全、可访问性、压力测试、发布说明、Git Tag 和正式 Release。

## 九、每轮输出模板

每轮结束严格按以下格式汇报：

```markdown
## Round X Complete

- Version:
- Commit:
- GitHub:
- Implemented:
- README updated:
- Screenshots:
- Tests:
- Build:
- Originality scan:
- Known limitations:
- Next round:
```

## 十、最终完成标准

只有同时满足以下条件才算完成：

- 所有十轮目标完成
- README 与实际功能一致
- 安装文档在干净环境验证成功
- Docker Compose 可启动完整服务
- 桌面和移动端无明显视觉缺陷
- 浅色和深色模式达到同等完成度
- 核心流程支持键盘与屏幕阅读器
- 无高危安全问题
- 无其他项目名称、代码和品牌痕迹
- GitHub main 与本地最终状态一致
- 发布 v1.0.0 Tag 和 GitHub Release

---

执行时始终记住：这是一个工具型产品。漂亮来自秩序、比例、细节和反馈，而不是装饰堆砌。
