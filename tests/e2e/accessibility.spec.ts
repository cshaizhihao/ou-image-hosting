import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const corePages = [
  { path: "/", heading: "把图片放进来，剩下的交给队列。" },
  { path: "/library", heading: "图片库" },
  { path: "/settings", heading: "设置中心" },
  { path: "/analytics", heading: "数据统计" },
  { path: "/system", heading: "系统状态" }
];

test("核心页面不存在 serious 或 critical Axe 问题", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);
  for (const item of corePages) {
    await page.goto(item.path);
    await expect(
      page.getByRole("heading", { name: item.heading, exact: true })
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = result.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical"
    );
    if (blocking.length > 0) {
      await testInfo.attach(
        `axe-${item.path === "/" ? "upload" : item.path.slice(1)}`,
        {
          body: JSON.stringify(blocking, null, 2),
          contentType: "application/json"
        }
      );
    }
    expect(
      blocking,
      `${item.path} has blocking Axe violations:\n${JSON.stringify(
        blocking,
        null,
        2
      )}`
    ).toEqual([]);
  }
});
