import { describe, expect, it } from "vitest";
import { paginationWindow } from "./pagination";

describe("paginationWindow", () => {
  it("keeps the first and final pages inside a stable window", () => {
    expect(paginationWindow(1, 12)).toEqual([1, 2, 3, 4, 5]);
    expect(paginationWindow(12, 12)).toEqual([8, 9, 10, 11, 12]);
  });

  it("centers the current page when enough pages are available", () => {
    expect(paginationWindow(6, 12)).toEqual([4, 5, 6, 7, 8]);
  });

  it("normalizes invalid input without returning empty navigation", () => {
    expect(paginationWindow(99, 3, 0)).toEqual([3]);
    expect(paginationWindow(-2, 0)).toEqual([1]);
  });
});
