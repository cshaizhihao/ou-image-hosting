export function libraryReturnHref(value?: string | string[]) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return "/library";
  try {
    const url = new URL(candidate, "http://library.local");
    if (url.origin !== "http://library.local" || url.pathname !== "/library") return "/library";
    return `${url.pathname}${url.search}`;
  } catch { return "/library"; }
}
