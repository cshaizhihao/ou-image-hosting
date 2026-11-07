export const storageProviderLabels = {
  local: "本地存储",
  s3: "Amazon S3",
  r2: "Cloudflare R2"
} as const;

export type StorageProvider = keyof typeof storageProviderLabels;
