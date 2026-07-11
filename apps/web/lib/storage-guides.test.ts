import { describe, expect, it } from "vitest";
import {
  explainStorageConnectionError,
  getStorageProviderGuide,
  storageProviderGuides,
  type StorageGuideProvider
} from "./storage-guides";

const providers = Object.keys(storageProviderGuides) as StorageGuideProvider[];

describe("storage provider guides", () => {
  it("provides complete ordered tutorials for S3 and R2", () => {
    expect(providers).toEqual(["s3", "r2"]);

    for (const provider of providers) {
      const guide = getStorageProviderGuide(provider);
      expect(guide.provider).toBe(provider);
      expect(guide.steps.length).toBeGreaterThanOrEqual(4);
      expect(guide.fields.length).toBeGreaterThanOrEqual(7);
      expect(new Set(guide.fields.map((field) => field.key)).size).toBe(
        guide.fields.length
      );
      expect(
        guide.fields.every(
          (field) => field.description.trim() && field.example.trim()
        )
      ).toBe(true);

      for (const step of guide.steps) {
        expect(step.title.trim()).not.toBe("");
        expect(step.description.trim()).not.toBe("");
        expect(step.checklist.length).toBeGreaterThanOrEqual(3);
        expect(step.checklist.every(Boolean)).toBe(true);
        expect(
          step.fieldKeys?.every((key) =>
            guide.fields.some((field) => field.key === key)
          ) ?? true
        ).toBe(true);
      }
    }
  });

  it("only links to the providers' official HTTPS destinations", () => {
    expect(storageProviderGuides.s3.consoleUrl).toMatch(
      /^https:\/\/console\.aws\.amazon\.com\//
    );
    expect(storageProviderGuides.s3.docsUrl).toMatch(
      /^https:\/\/docs\.aws\.amazon\.com\//
    );
    expect(storageProviderGuides.r2.consoleUrl).toMatch(
      /^https:\/\/dash\.cloudflare\.com\//
    );
    expect(storageProviderGuides.r2.docsUrl).toMatch(
      /^https:\/\/developers\.cloudflare\.com\//
    );
  });

  it("turns common provider failures into actionable guidance", () => {
    expect(explainStorageConnectionError("AccessDenied: 403", "s3").title).toBe(
      "凭证没有所需权限"
    );
    expect(
      explainStorageConnectionError("NoSuchBucket", "r2").suggestions.join(" ")
    ).toContain("Account ID");
    expect(
      explainStorageConnectionError("AuthorizationHeaderMalformed: region", "s3")
        .title
    ).toBe("区域设置不一致");
    expect(explainStorageConnectionError("ETIMEDOUT", "r2").title).toBe(
      "无法连接到存储服务"
    );
  });
});
