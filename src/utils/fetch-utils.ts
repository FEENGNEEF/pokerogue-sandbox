import { globalManifest } from "#app/global-manifest";

export function getCachedUrl(url: string): string {
  const normalizedPath = url.replace(/^\.\//, "");
  const isLocale = normalizedPath.startsWith("locales/");
  const externalBase = isLocale ? import.meta.env.VITE_EXTERNAL_LOCALES_BASE : import.meta.env.VITE_EXTERNAL_ASSETS_BASE;

  if (externalBase) {
    return new URL(normalizedPath.replace(/^locales\//, ""), externalBase).toString();
  }

  const manifest = globalManifest;
  if (!manifest) {
    return url;
  }

  const normalizedUrl = `/${url.replace("./", "")}`;
  const timestamp = manifest[normalizedUrl];
  if (timestamp) {
    url += `?t=${timestamp}`;
  }
  return url;
}

export function cachedFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(getCachedUrl(url), init);
}
