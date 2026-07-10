import { expect, test as setup } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export const ownerEmail = "owner.e2e@example.com";
export const ownerPassword = "OuImage!2026Strong";
const authFile = path.resolve("output/playwright/auth/owner.json");

setup("安装、首次引导与重新登录", async ({ page }) => {
  const fontResponse = await page.request.get(
    "/fonts/ou-brand-display-black.woff2"
  );
  expect(fontResponse.status()).toBe(200);

  const anonymousRoot = await page.request.get("/", { maxRedirects: 0 });
  expect(anonymousRoot.status()).toBe(307);
  const redirectUrl = new URL(anonymousRoot.headers().location);
  expect(redirectUrl.origin).toBe(new URL(anonymousRoot.url()).origin);
  expect(redirectUrl.pathname).toBe("/login");

  await page.goto("/install");
  await expect(
    page.getByRole("heading", { name: "先确认运行环境" })
  ).toBeVisible();
  await page.getByRole("button", { name: "继续配置" }).click();

  await page.getByLabel("站点名称").fill("OU-Image Hosting E2E");
  await page.getByLabel("管理员名称").fill("欧记测试员");
  await page.getByLabel("管理员邮箱").fill(ownerEmail);
  await page.getByLabel("管理员密码").fill(ownerPassword);
  await page.getByRole("button", { name: "浅色" }).click();
  await page.getByRole("button", { name: "创建站点" }).click();

  await expect(
    page.getByRole("heading", { name: "你的图床已经准备好了" })
  ).toBeVisible();
  await page.getByRole("link", { name: "开始使用" }).click();
  await expect(
    page.getByRole("heading", { name: "把工作区调成你喜欢的样子" })
  ).toBeVisible();
  await page.getByRole("button", { name: "浅色" }).click();
  await page.getByRole("button", { name: "进入工作区" }).click();

  await expect(
    page.getByRole("heading", { name: "把图片放进来，剩下的交给队列。" })
  ).toBeVisible();
  await page.getByRole("button", { name: "打开用户菜单" }).click();
  await page.getByText("退出登录", { exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "欢迎回来" })
  ).toBeVisible();
  await page.getByLabel("邮箱地址").fill(ownerEmail);
  await page.locator('input[name="password"]').fill(ownerPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(
    page.getByRole("heading", { name: "把图片放进来，剩下的交给队列。" })
  ).toBeVisible();

  await mkdir(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
