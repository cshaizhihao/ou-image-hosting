import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers";

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 }
];
const themes = ["light", "dark"] as const;
const routes = ["/", "/library", "/settings", "/analytics", "/system"];

test("375/768/1024/1440 浅色深色均无水平溢出", async ({ page }) => {
  test.setTimeout(180_000);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const theme of themes) {
      await page.goto("/");
      await page.evaluate((value) => {
        window.localStorage.setItem("ou-theme", value);
      }, theme);
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator("main").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          theme
        );
        await expectNoHorizontalOverflow(page);
      }
    }
  }
});

test("prefers-reduced-motion 会全局关闭非必要动画", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "数据统计" })).toBeVisible();
  const motion = await page.evaluate(() => {
    const target = document.querySelector("button")!;
    const style = getComputedStyle(target);
    return {
      animationName: style.animationName,
      transitionDuration: style.transitionDuration
    };
  });
  expect(motion.animationName).toBe("none");
  expect(motion.transitionDuration).toBe("0s");
});
