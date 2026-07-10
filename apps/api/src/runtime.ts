const insecureSecretDefaults = new Set([
  "replace-with-a-long-random-production-secret",
  "change-me",
  "changeme",
  "default",
  "secret",
  "ou-image-secret"
]);

function localhostOrigin(url: URL) {
  return (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  );
}

export function assertProductionConfiguration(
  environment: NodeJS.ProcessEnv
) {
  if (environment.NODE_ENV !== "production") return;
  const secret = environment.OU_SECRET_KEY?.trim() ?? "";
  if (
    secret.length < 32 ||
    insecureSecretDefaults.has(secret.toLowerCase())
  ) {
    throw new Error(
      "生产环境 OU_SECRET_KEY 必须是至少 32 字符的非默认随机密钥"
    );
  }
  let origin: URL;
  try {
    origin = new URL(environment.APP_ORIGIN ?? "");
  } catch {
    throw new Error("生产环境必须配置有效的 APP_ORIGIN");
  }
  if (
    origin.protocol !== "https:" &&
    !(origin.protocol === "http:" && localhostOrigin(origin))
  ) {
    throw new Error(
      "生产环境 APP_ORIGIN 必须使用 HTTPS；仅 localhost 允许 HTTP"
    );
  }
  if (environment.EXPOSE_DEVELOPMENT_RESET_TOKEN === "true") {
    throw new Error(
      "生产环境禁止启用 EXPOSE_DEVELOPMENT_RESET_TOKEN"
    );
  }
}
