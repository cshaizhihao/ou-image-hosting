export function paginationWindow(
  currentPage: number,
  totalPages: number,
  visiblePages = 5
) {
  const safeTotal = Math.max(1, Math.floor(totalPages));
  const safeCurrent = Math.min(
    safeTotal,
    Math.max(1, Math.floor(currentPage))
  );
  const windowSize = Math.min(
    safeTotal,
    Math.max(1, Math.floor(visiblePages))
  );
  const half = Math.floor(windowSize / 2);
  const start = Math.min(
    Math.max(1, safeCurrent - half),
    safeTotal - windowSize + 1
  );

  return Array.from({ length: windowSize }, (_, index) => start + index);
}
