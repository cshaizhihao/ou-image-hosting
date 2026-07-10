# OU-Image Hosting Design System

> Global source of truth for application UI. Page-specific overrides may be added under `pages/`.

## Product Character

- Editorial utility
- Content-first image workspace
- Calm, precise and friendly
- Light mode first, full dark-mode parity
- Cat personality used sparingly through brand assets and empty states

## Brand Tokens

```css
:root {
  --ou-ink: #0b0b0b;
  --ou-charcoal: #303030;
  --ou-pink: #ef8f8f;
  --ou-pink-hover: #d96f6f;
  --ou-blush: #fbe7e7;

  --ou-page: #f7f7f5;
  --ou-panel: #ffffff;
  --ou-muted: #f0f0ed;
  --ou-border: #e3e3df;

  --ou-text: #1a1a1a;
  --ou-text-secondary: #696966;

  --ou-success: #2f855a;
  --ou-warning: #b7791f;
  --ou-danger: #c84545;
  --ou-info: #3973a8;

  --ou-radius-sm: 6px;
  --ou-radius-md: 8px;
  --ou-radius-lg: 12px;

  --ou-motion-fast: 160ms;
  --ou-motion-standard: 220ms;
  --ou-motion-slow: 320ms;
}
```

Dark mode maps semantic tokens to neutral black surfaces. Do not simply invert colors. The pink accent must remain readable and cannot be used for large text blocks.

## Typography

```css
--font-heading: "Geist", "Noto Sans SC", sans-serif;
--font-body: "Inter", "Noto Sans SC", sans-serif;
--font-mono: "JetBrains Mono", monospace;
```

- H1: 32/26px, weight 650
- H2: 24/22px, weight 650
- H3: 18px, weight 600
- Body: 15–16px desktop, 16px mobile
- Label: 13–14px, weight 500
- Caption: 12px
- Letter spacing: 0

## Spacing

Use a 4px base scale:

`4, 8, 12, 16, 20, 24, 32, 40, 48, 64`

- Page gutter: 16px mobile, 24px tablet, 32px desktop
- Component gap: 8–12px
- Section gap: 24–32px
- Touch targets: minimum 44×44px

## Layout

- Desktop: 248px sidebar, 64px top bar, fluid main workspace
- Tablet: collapsible sidebar
- Mobile: top bar + drawer
- Never combine sidebar, tabs and bottom navigation at the same hierarchy
- Avoid nested scroll containers
- Preserve filters, view mode and scroll position

## Surfaces

- Application sections are unframed by default
- Use panels only for real tools, repeated items, dialogs and drawers
- No card-inside-card composition
- Primary radius: 8px
- Large modal/drawer radius: 12px
- Shadows only for floating overlays and active drag states

## Buttons

- Primary: pink background, dark readable text when contrast allows
- Secondary: white/neutral surface with visible border
- Destructive: semantic red, spatially separated
- Icon buttons: Lucide icon, tooltip, aria-label
- Loading buttons: disabled with spinner and stable width
- Pressed states cannot shift surrounding layout

## Forms

- Visible labels
- Helper text for non-obvious inputs
- Validate on blur
- Error placed directly below the field
- Focus the first invalid field after submit
- Inputs are at least 44px high

## Image Workspace

- Upload queue is the primary first-screen task
- Queue rows display thumbnail, filename, dimensions, size, state and actions
- Each item supports cancel and retry
- Overall progress and per-file progress are both visible
- Completed items expose URL, Markdown, HTML and BBCode copy actions

## Gallery

- Grid, masonry and list modes
- Search remains visible
- Filters use dropdowns, chips and date controls
- Selection exposes a sticky bulk-action bar
- Details open in a drawer while preserving library context
- 50+ visible items require virtualization

## Motion

- Hover and press: 160ms
- Menus, tabs and filters: 220ms
- Dialogs and drawers: 320ms
- Enter uses ease-out; exit is shorter
- Animate transform and opacity only
- Respect `prefers-reduced-motion`
- No decorative page-cover transitions

## Accessibility

- Text contrast: WCAG AA
- Visible focus rings
- Full keyboard navigation
- Images have meaningful alt text
- Status changes use `aria-live`
- Color is never the only state indicator
- Charts provide text/table alternatives

## Forbidden Patterns

- Purple-blue gradient themes
- Decorative glow or bokeh blobs
- Glassmorphism as a default surface
- Radius above 12px for standard application UI
- Marketing hero as the authenticated app homepage
- Emoji as structural icons
- Placeholder-only form labels
- Silent async operations
- Destructive actions without confirmation or recovery

## Required Viewport Validation

- 375px
- 768px
- 1024px
- 1440px

Every visual release must include real screenshots in light and dark modes and verify no overlap, clipping or horizontal scroll.
