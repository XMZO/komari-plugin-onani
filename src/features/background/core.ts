export const BACKGROUND_PATH = "/api/plugins/onani/background";
export const DEFAULT_SOURCE = "https://t.alcy.cc/ycy/";

export type BackgroundConfig = { enabled: boolean; webp: boolean; source: string; quality: number };
export type ImageMetadata = {
  id: string;
  originalMime: string;
  previewMime: string;
  extension: string;
  originalBytes: number;
  previewBytes: number;
  expiresAt: number;
  webp: boolean;
};

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

export function resolveBackgroundConfig(raw: Record<string, unknown>): BackgroundConfig {
  const source = typeof raw.background_source === "string" && raw.background_source.trim() ? raw.background_source.trim() : DEFAULT_SOURCE;
  // Keep in sync with the helper; Go also validates every redirect and resolved IP.
  if (!/^https:\/\/(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:]+\])(?::443)?(?:\/[^\s#\\]*)?$/i.test(source)) {
    throw new Error("背景源需要不含用户名密码的公网 HTTPS 图片地址");
  }
  return {
    enabled: raw.background_enabled === true,
    webp: raw.background_webp === true,
    source,
    quality: bounded(raw.background_quality, 78, 40, 90),
  };
}

export function parseMetadata(value: unknown): ImageMetadata {
  if (!value || typeof value !== "object") throw new Error("Invalid image metadata");
  const m = value as ImageMetadata;
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  if (!/^[a-f0-9]{64}$/.test(m.id) || !extensions[m.originalMime] || !extensions[m.previewMime]
    || extensions[m.originalMime] !== m.extension || typeof m.webp !== "boolean"
    || !Number.isSafeInteger(m.expiresAt) || m.expiresAt <= 0
    || !Number.isSafeInteger(m.originalBytes) || m.originalBytes <= 0 || m.originalBytes > 16 * 1024 * 1024
    || !Number.isSafeInteger(m.previewBytes) || m.previewBytes <= 0 || m.previewBytes > m.originalBytes) {
    throw new Error("Invalid image metadata");
  }
  return m;
}

export function parseOriginalPath(url: string): string | null {
  return /^\/api\/plugins\/onani\/background\/([a-f0-9]{64})\/original(?:\?.*)?$/.exec(url)?.[1] ?? null;
}

export function originalPath(id: string): string {
  return `${BACKGROUND_PATH}/${id}/original`;
}
