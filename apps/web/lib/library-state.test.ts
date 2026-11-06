import { expect, it } from "vitest";
import { libraryReturnHref } from "./library-state";

it("keeps library filters while rejecting external or unrelated return targets", () => {
  expect(libraryReturnHref("/library?q=cat&page=3")).toBe("/library?q=cat&page=3");
  expect(libraryReturnHref("https://evil.example/library")).toBe("/library");
  expect(libraryReturnHref("//evil.example/library")).toBe("/library");
  expect(libraryReturnHref("/settings")).toBe("/library");
});
