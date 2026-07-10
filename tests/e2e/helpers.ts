import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const imageName = "ou-e2e-smoke.jpg";

export function imageFixture() {
  return readFile(
    resolve(
      process.cwd(),
      "apps/web/public/brand/ou-image-hosting-logo.jpg"
    )
  );
}

export async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  expect(
    Math.max(dimensions.body, dimensions.document),
    `horizontal overflow: body=${dimensions.body}, document=${dimensions.document}, viewport=${dimensions.viewport}`
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

export async function expectVisibleFocus(page: Page) {
  const focus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const candidates = [active, active.parentElement].filter(
      (element): element is HTMLElement => element instanceof HTMLElement
    );
    return {
      indicators: candidates.map((element) => {
        const style = getComputedStyle(element);
        return {
          boxShadow: style.boxShadow,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          tagName: element.tagName
        };
      }),
      tagName: active.tagName
    };
  });
  expect(focus).not.toBeNull();
  const hasVisibleIndicator = focus?.indicators.some((indicator) => {
    const hasOutline =
      indicator.outlineStyle !== "none" &&
      Number.parseFloat(indicator.outlineWidth) > 0;
    const hasFocusShadow =
      Boolean(indicator.boxShadow) && indicator.boxShadow !== "none";
    return hasOutline || hasFocusShadow;
  });
  expect(
    hasVisibleIndicator,
    `focused ${focus?.tagName ?? "element"} has no visible focus indicator`
  ).toBe(true);
}
