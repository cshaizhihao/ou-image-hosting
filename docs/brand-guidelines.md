# OU-Image Hosting Brand Guidelines v0.1

## Quick Reference

- **品牌名称：** OU-Image Hosting
- **中文名称：** 欧记图床
- **品牌主张：** 好看、好用、好管理的现代自托管图床
- **主色：** Charcoal `#303030`
- **强调色：** Nose Pink `#EF8F8F`
- **背景色：** Warm White `#F7F7F5`
- **标题字体：** Geist Sans / Noto Sans SC
- **正文字体：** Inter / Noto Sans SC
- **代码字体：** JetBrains Mono
- **品牌语气：** 克制、清楚、友好、可靠

## 1. 品牌定位

OU-Image Hosting 是为个人创作者、开发者和小型团队设计的图片托管与资产管理平台。

它不强调复杂运维术语，而是让用户感受到：

- 上传过程流畅而可信
- 图片管理清晰而高效
- 界面有设计感但不过度装饰
- 自托管产品也可以具备成熟商业软件的完成度

## 2. Logo

### 主 Logo

主 Logo 使用用户提供的黑白猫图像：

`docs/assets/logo/ou-image-hosting-logo.jpg`

### 使用规则

- 保持原始比例，不拉伸、不压缩、不旋转。
- 不改变猫咪主体颜色。
- 不添加阴影、描边、渐变和发光。
- 不裁切眼睛、耳朵、鼻尖和身体轮廓。
- 图标周围最小留白等于 Logo 宽度的 12.5%。
- 复杂背景上必须增加纯色承载面。

### 最小尺寸

- Favicon / 图标：24px
- 应用导航：32px
- README / 文档：120px
- 品牌展示：180px 以上

### 后续资产

第 2 轮需要制作：

- 透明背景 PNG
- 512×512 App Icon
- 180×180 Apple Touch Icon
- 32×32 与 16×16 Favicon
- 横版 Logo：猫咪图标 + OU-Image Hosting 字标
- 深色背景反白版本

## 3. 色彩系统

### Brand

| Token | Hex | 用途 |
|---|---|---|
| `brand-ink` | `#0B0B0B` | 最高强调、深色按钮 |
| `brand-charcoal` | `#303030` | 主品牌色、标题 |
| `brand-pink` | `#EF8F8F` | 主 CTA、选中态、焦点 |
| `brand-pink-dark` | `#D96F6F` | Hover、深色模式强调 |
| `brand-blush` | `#FBE7E7` | 轻强调背景 |

### Neutral

| Token | Hex | 用途 |
|---|---|---|
| `surface-page` | `#F7F7F5` | 页面背景 |
| `surface-panel` | `#FFFFFF` | 面板 |
| `surface-muted` | `#F0F0ED` | 次级区域 |
| `border-default` | `#E3E3DF` | 边框 |
| `text-primary` | `#1A1A1A` | 主文本 |
| `text-secondary` | `#696966` | 次文本 |

### Semantic

| Token | Hex |
|---|---|
| Success | `#2F855A` |
| Warning | `#B7791F` |
| Danger | `#C84545` |
| Info | `#3973A8` |

颜色不能单独传递状态，必须同时使用图标或文本。

## 4. 字体

```css
--font-heading: "Geist", "Noto Sans SC", sans-serif;
--font-body: "Inter", "Noto Sans SC", sans-serif;
--font-mono: "JetBrains Mono", monospace;
```

| 元素 | Desktop | Mobile | Weight |
|---|---:|---:|---:|
| H1 | 32px | 26px | 650 |
| H2 | 24px | 22px | 650 |
| H3 | 18px | 18px | 600 |
| Body | 15–16px | 16px | 400 |
| Label | 13–14px | 14px | 500 |
| Caption | 12px | 12px | 400 |

不使用负字间距，不用超大标题挤占工具界面。

## 5. UI 风格

### 核心风格

**Editorial Utility：编辑器式工具界面 + 轻度品牌个性。**

- 内容优先，不使用营销页面式的大 Hero 作为应用首页。
- 主界面使用稳定侧栏、顶栏和工作区。
- 避免卡片套卡片。
- 主要圆角 8px，弹窗和大容器最多 12px。
- 阴影只用于悬浮层、弹窗和拖拽反馈。
- 品牌粉只用于主操作、选中状态和关键反馈。
- 猫咪元素用于 Logo、空状态和少量彩蛋，不作为结构图标。

### 禁止项

- 大面积紫色或蓝紫渐变
- 玻璃拟态堆叠
- 发光光球、Bokeh、装饰性渐变背景
- 20px 以上的泛滥圆角
- 每个区块都做成悬浮卡片
- 无意义的入场动画
- Emoji 作为导航或功能图标

## 6. 组件规则

- 按钮、输入框、菜单项最低高度 44px。
- 图标按钮必须有 Tooltip 和 `aria-label`。
- 表单必须有可见 Label、说明和就近错误信息。
- 删除操作必须确认，批量删除提供撤销窗口。
- 上传超过 300ms 必须显示逐文件进度。
- 列表超过 50 项启用虚拟化。
- 所有图片预留宽高或 `aspect-ratio`，避免布局跳动。

## 7. 动效

| Token | Duration | 用途 |
|---|---:|---|
| Fast | 160ms | Hover、Pressed、Tooltip |
| Standard | 220ms | 菜单、Tabs、筛选 |
| Slow | 320ms | Drawer、Dialog、页面区域切换 |

- Enter 使用 ease-out，Exit 更快。
- 只动画 `transform` 与 `opacity`。
- 动效必须可中断。
- 支持 `prefers-reduced-motion`。

## 8. 品牌语气

### 我们是

- 清楚：直接说明发生了什么。
- 友好：不给用户制造压力。
- 可靠：错误提示提供原因和恢复方式。
- 克制：不使用夸张口号和过度俏皮表达。

### 我们不是

- 冷冰冰的系统日志
- 幼稚的宠物应用
- 堆砌技术名词的开发者玩具
- 充满感叹号和营销话术的 SaaS

### 示例

- 成功：`已上传 8 张图片，可直接复制全部链接。`
- 失败：`3 张图片上传失败。网络连接已恢复，点击重试。`
- 空状态：`这里还没有图片。拖入第一张图片开始建立图库。`
- 删除：`图片将在 7 天后永久删除，你可以在回收站恢复。`
