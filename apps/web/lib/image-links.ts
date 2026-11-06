export type ImageLinkFormat = "url" | "markdown" | "html" | "bbcode";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function imageLink(name: string, url: string, format: ImageLinkFormat) {
  if (format === "html") return `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" />`;
  if (format === "markdown") {
    const label = name.replace(/[\\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
    const target = url.replaceAll("(", "%28").replaceAll(")", "%29").replace(/[\r\n]/g, "");
    return `![${label}](${target})`;
  }
  if (format === "bbcode") return `[img]${url.replaceAll("[", "%5B").replaceAll("]", "%5D")}[/img]`;
  return url;
}

export function withImageVersion(value: string, version: string) {
  const url = new URL(value, "http://image.local");
  url.searchParams.set("v", version);
  return /^https?:\/\//i.test(value) ? url.href : `${url.pathname}${url.search}${url.hash}`;
}
