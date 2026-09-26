export type StorageProviderKey = "local" | "s3" | "r2";

export const storageProviderLabels: Record<StorageProviderKey, string> = {
  local: "本地存储",
  s3: "Amazon S3",
  r2: "Cloudflare R2"
};

export function storageProviderLabel(provider?: StorageProviderKey | null) {
  return storageProviderLabels[provider ?? "local"];
}

export function storageRunningLabel(provider?: StorageProviderKey | null) {
  const label = storageProviderLabel(provider);
  return provider && provider !== "local" ? `${label} 运行中` : `${label}运行中`;
}
