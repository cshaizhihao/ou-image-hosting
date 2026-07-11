import { expect, test } from "@playwright/test";
import { expectVisibleFocus, imageFixture, imageName } from "./helpers";

test.describe.configure({ mode: "serial" });

test("键盘上传、图库、详情与公开分享核心流程", async ({
  browser,
  page
}) => {
  await page.goto("/upload");
  const dropZone = page.locator(".upload-drop");
  await dropZone.focus();
  await expectVisibleFocus(page);

  const chooserPromise = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: imageName,
    mimeType: "image/jpeg",
    buffer: await imageFixture()
  });
  await expect(page.locator(`input[value="${imageName}"]`)).toBeVisible();
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/uploads"
  );
  await page.getByRole("button", { name: "开始上传 1 张" }).click();
  const uploadResponse = await uploadResponsePromise;
  const uploadBody = await uploadResponse.text();
  expect(
    uploadResponse.status(),
    `POST /api/uploads returned ${uploadResponse.status()}: ${uploadBody}`
  ).toBeLessThan(300);

  await expect(page.getByText("上传完成", { exact: true })).toBeVisible({
    timeout: 20_000
  });
  await page.getByRole("link", { name: "图片库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "图片库" })).toBeVisible();
  await page
    .getByRole("link", { name: `查看 ${imageName} 详情` })
    .click();
  await expect(page.getByRole("heading", { name: imageName })).toBeVisible();

  const createShare = page.getByRole("button", { name: "创建分享链接" });
  await createShare.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(createShare).toBeFocused();
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");
  await expect(page.getByText("分享已就绪")).toBeVisible();
  const shareUrl = await page.locator("code").filter({
    hasText: "/share/"
  }).textContent();
  expect(shareUrl).toBeTruthy();
  const absoluteShareUrl = new URL(shareUrl!, page.url()).toString();

  const publicContext = await browser.newContext({
    locale: "zh-CN",
    serviceWorkers: "block"
  });
  const publicPage = await publicContext.newPage();
  await publicPage.goto(absoluteShareUrl);
  await expect(publicPage.getByText(imageName, { exact: true })).toBeVisible();
  await publicContext.close();
});

test("设置、统计与系统状态核心 smoke", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "设置中心" })).toBeVisible();
  await page.getByRole("button", { name: "站点外观" }).click();
  await expect(page.getByText("站点公开信息")).toBeVisible();
  await page.getByRole("button", { name: "图片处理" }).click();
  await expect(page.getByText("上传规则")).toBeVisible();

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "数据统计" })).toBeVisible();
  await expect(page.getByText("原图版本占用")).toBeVisible();

  await page.goto("/system");
  await expect(page.getByRole("heading", { name: "系统状态" })).toBeVisible();
  await page.getByRole("button", { name: "立即检查" }).click();
  await expect(page.getByText("最近检查", { exact: false })).toBeVisible({
    timeout: 20_000
  });
  await expect(
    page.getByRole("heading", { name: "后台任务", exact: true })
  ).toBeVisible();
});

test("命令面板可完全使用键盘导航", async ({ page }) => {
  await page.goto("/overview");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("textbox", { name: "搜索页面" });
  await expect(search).toBeFocused();
  await expectVisibleFocus(page);
  await search.fill("图片库");
  await page.keyboard.press("Tab");
  await expectVisibleFocus(page);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page.getByRole("heading", { name: "图片库", exact: true })
  ).toBeVisible();
});
