import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.OU_SCREENSHOT_BASE_URL ?? "http://127.0.0.1:3000";
const outputDirectory = path.resolve("docs/screenshots");
const imagePath = path.resolve(
  process.env.OU_SCREENSHOT_IMAGE ??
    "apps/web/public/brand/ou-image-hosting-logo.jpg"
);
const ownerEmail =
  process.env.OU_SCREENSHOT_OWNER_EMAIL ?? "release@example.com";
const ownerPassword =
  process.env.OU_SCREENSHOT_OWNER_PASSWORD ?? "OuImage!2026Release";

const runtimeErrors = [];
const browser = await chromium.launch({ headless: true });

function trackErrors(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`${label} console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    runtimeErrors.push(`${label} page: ${error.message}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      runtimeErrors.push(
        `${label} response: ${response.status()} ${response.url()}`
      );
    }
  });
}

async function waitForVisuals(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(250);
}

try {
  await mkdir(outputDirectory, { recursive: true });

  const desktop = await browser.newContext({
    baseURL,
    colorScheme: "light",
    locale: "zh-CN",
    serviceWorkers: "block",
    viewport: { width: 1440, height: 1000 }
  });
  const page = await desktop.newPage();
  trackErrors(page, "desktop");

  await page.goto("/install");
  await page
    .getByRole("heading", { name: "先确认运行环境", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "继续配置" }).click();
  await page.getByLabel("站点名称").fill("OU-Image Hosting");
  await page.getByLabel("管理员名称").fill("欧记测试员");
  await page.getByLabel("管理员邮箱").fill(ownerEmail);
  await page.getByLabel("管理员密码").fill(ownerPassword);
  await page.getByRole("button", { name: "浅色" }).click();
  const setupResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" && url.pathname === "/api/setup"
    );
  });
  await page.getByRole("button", { name: "创建站点" }).click();
  const setupResponse = await setupResponsePromise;
  if (!setupResponse.ok()) {
    throw new Error(
      `POST /api/setup returned ${setupResponse.status()}: ${await setupResponse.text()}`
    );
  }
  await page
    .getByRole("heading", { name: "你的图床已经准备好了", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "开始使用" }).click();
  await page
    .getByRole("heading", {
      name: "把工作区调成你喜欢的样子",
      exact: true
    })
    .waitFor();
  await page.getByRole("button", { name: "浅色" }).click();
  await page.getByRole("button", { name: "进入工作区" }).click();
  await page
    .getByRole("heading", {
      name: "把图片放进来，剩下的交给队列。",
      exact: true
    })
    .waitFor();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator(".upload-drop").press("Enter");
  const chooser = await chooserPromise;
  await chooser.setFiles(imagePath);
  await page.getByText("上传完成", { exact: true }).waitFor({
    timeout: 20_000
  });
  await waitForVisuals(page);
  await page.screenshot({
    path: path.join(outputDirectory, "ou-image-hosting-main.png")
  });

  await desktop.close();

  if (runtimeErrors.length > 0) {
    throw new Error(runtimeErrors.join("\n"));
  }

  console.log(
    JSON.stringify(
      {
        screenshots: ["ou-image-hosting-main.png"]
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
