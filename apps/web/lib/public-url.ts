type PublicUrlOptions = {
  configuredOrigin?: string;
  requestUrl: string;
  forwardedProtocol?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
};

function firstHeaderValue(value?: string | null) {
  return value?.split(",")[0]?.trim() || undefined;
}

function validOrigin(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function createPublicUrl(pathname: string, options: PublicUrlOptions) {
  const configuredOrigin = validOrigin(options.configuredOrigin?.trim());
  if (configuredOrigin) {
    return new URL(pathname, configuredOrigin);
  }

  const requestUrl = new URL(options.requestUrl);
  const protocol = firstHeaderValue(options.forwardedProtocol);
  const host =
    firstHeaderValue(options.forwardedHost) ?? firstHeaderValue(options.host);

  if ((protocol === "http" || protocol === "https") && host) {
    const forwardedOrigin = validOrigin(`${protocol}://${host}`);
    if (forwardedOrigin) {
      return new URL(pathname, forwardedOrigin);
    }
  }

  return new URL(pathname, requestUrl.origin);
}
