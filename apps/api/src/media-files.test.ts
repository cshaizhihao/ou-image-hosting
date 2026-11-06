import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { inspectLivePhotoVideo, parseByteRange } from "./media-files.js";

describe("media delivery", () => {
  it("accepts a real MP4 and rejects disguised or truncated content", async () => {
    const video = await readFile(new URL("../test-fixtures/live-preview.mp4", import.meta.url));
    expect(inspectLivePhotoVideo(video).mime).toBe("video/mp4");
    expect(() => inspectLivePhotoVideo(Buffer.from("not a video"))).toThrow();
    expect(() => inspectLivePhotoVideo(video.subarray(0, video.length - 1))).toThrow();
    const oversizedAtom = Buffer.from(video);
    oversizedAtom.writeUInt32BE(0xffffffff, 0);
    expect(() => inspectLivePhotoVideo(oversizedAtom)).toThrow();
  });

  it("handles Safari-style suffix ranges, open ranges and unsatisfiable requests", () => {
    expect(parseByteRange("bytes=0-1", 100)).toEqual({ start: 0, end: 1 });
    expect(parseByteRange("bytes=95-", 100)).toEqual({ start: 95, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=0-1000", 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=100-200", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=10-5", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-1,5-10", 100)).toBeNull();
    expect(parseByteRange("invalid", 100)).toBeNull();
  });
});
