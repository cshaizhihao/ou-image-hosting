import { describe, expect, it } from "vitest";
import { imageLink, withImageVersion } from "./image-links";

describe("image links", () => {
  it("preserves signed parameters when adding a preview version", () => {
    const result = withImageVersion("/api/files/1/original?expires=123&signature=abc", "v2");
    const parsed = new URL(result, "http://localhost");
    expect(parsed.searchParams.get("signature")).toBe("abc");
    expect(parsed.searchParams.get("expires")).toBe("123");
    expect(parsed.searchParams.get("v")).toBe("v2");
    expect(withImageVersion("https://cdn.example.com/photo?v=old", "new")).toBe("https://cdn.example.com/photo?v=new");
  });
  it("escapes filenames in copied HTML and Markdown", () => {
    expect(imageLink('a"<b>.jpg', "https://example.com/a?x=1&y=2", "html"))
      .toBe('<img src="https://example.com/a?x=1&amp;y=2" alt="a&quot;&lt;b&gt;.jpg" />');
    expect(imageLink("a[b]\\c.jpg", "https://example.com/a(b)", "markdown"))
      .toBe("![a\\[b\\]\\\\c.jpg](https://example.com/a%28b%29)");
  });
});
