import { describe, expect, it } from "vitest";
import {
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

      for (const step of guide.steps) {
        expect(step.title.trim()).not.toBe("");
        expect(step.description.trim()).not.toBe("");
        expect(step.checklist.length).toBeGreaterThanOrEqual(3);
        expect(step.checklist.every(Boolean)).toBe(true);
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
});
