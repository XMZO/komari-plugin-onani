export const HOSTNAME_CACHE_SCHEMA = 1 as const;
export const DEFAULT_CACHE_DAYS = 30;
export const MIN_CACHE_DAYS = 1;
export const MAX_CACHE_DAYS = 3650;
export const RETRY_BACKOFF_MS = 24 * 60 * 60 * 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_HOSTNAME_CHARACTER = /[\s/\\:<>"'`]/u;

export type HostnameConfigInput = {
  hostname_enabled?: unknown;
  hostname_auto_refresh?: unknown;
  hostname_cache_days?: unknown;
};

export type HostnameConfig = {
  enabled: boolean;
  autoRefresh: boolean;
  cacheDays: number;
  cacheTtlMs: number;
};

export type HostnameCacheEntry = {
  hostname?: string;
  collected_at?: string;
  last_attempt_at?: string;
  last_error?: string;
};

export type HostnameCache = {
  schema: typeof HOSTNAME_CACHE_SCHEMA;
  updated_at: string | null;
  entries: Record<string, HostnameCacheEntry>;
};

export type HostnameResult =
  | { ok: true; hostname: string }
  | { ok: false; error: string };

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asCacheDays(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CACHE_DAYS;
  const days = Math.trunc(numeric);
  if (days < MIN_CACHE_DAYS || days > MAX_CACHE_DAYS) {
    return DEFAULT_CACHE_DAYS;
  }
  return days;
}

export function resolveHostnameConfig(input: HostnameConfigInput): HostnameConfig {
  const cacheDays = asCacheDays(input.hostname_cache_days);
  return {
    enabled: asBoolean(input.hostname_enabled, true),
    autoRefresh: asBoolean(input.hostname_auto_refresh, true),
    cacheDays,
    cacheTtlMs: cacheDays * 24 * 60 * 60 * 1000,
  };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeUuidList(value: unknown, limit = 500): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    if (!isUuid(item)) continue;
    unique.add(item.toLowerCase());
    if (unique.size >= limit) break;
  }
  return [...unique];
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeCacheEntry(value: unknown): HostnameCacheEntry | null {
  if (!isRecord(value)) return null;
  const entry: HostnameCacheEntry = {};
  const normalizedHostname = normalizeHostname(value.hostname);
  if (normalizedHostname.ok) {
    entry.hostname = normalizedHostname.hostname;
  }
  if (validIsoTimestamp(value.collected_at)) entry.collected_at = value.collected_at;
  if (validIsoTimestamp(value.last_attempt_at)) entry.last_attempt_at = value.last_attempt_at;
  if (typeof value.last_error === "string" && value.last_error.trim()) {
    entry.last_error = safeErrorText(value.last_error);
  }
  return entry;
}

export function emptyHostnameCache(): HostnameCache {
  return {
    schema: HOSTNAME_CACHE_SCHEMA,
    updated_at: null,
    entries: Object.create(null) as Record<string, HostnameCacheEntry>,
  };
}

export function normalizeHostnameCache(value: unknown): HostnameCache {
  const cache = emptyHostnameCache();
  if (!isRecord(value) || value.schema !== HOSTNAME_CACHE_SCHEMA || !isRecord(value.entries)) {
    return cache;
  }
  if (validIsoTimestamp(value.updated_at)) cache.updated_at = value.updated_at;
  for (const [uuid, candidate] of Object.entries(value.entries)) {
    if (!isUuid(uuid)) continue;
    const entry = normalizeCacheEntry(candidate);
    if (entry) cache.entries[uuid.toLowerCase()] = entry;
  }
  return cache;
}

export function shouldRefreshHostname(
  entry: HostnameCacheEntry | undefined,
  nowMs: number,
  cacheTtlMs: number,
  retryBackoffMs = RETRY_BACKOFF_MS,
): boolean {
  if (entry?.hostname && entry.collected_at) {
    const collectedAt = Date.parse(entry.collected_at);
    if (Number.isFinite(collectedAt) && nowMs - collectedAt < cacheTtlMs) {
      return false;
    }
  }

  if (entry?.last_attempt_at) {
    const lastAttemptAt = Date.parse(entry.last_attempt_at);
    if (Number.isFinite(lastAttemptAt) && nowMs - lastAttemptAt < retryBackoffMs) {
      return false;
    }
  }
  return true;
}

export function normalizeHostname(output: unknown): HostnameResult {
  if (typeof output !== "string") {
    return { ok: false, error: "Agent 未返回文本结果" };
  }
  const lines = output
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) {
    return { ok: false, error: lines.length === 0 ? "Agent 返回了空主机名" : "Agent 返回了多行结果" };
  }
  const hostname = lines[0];
  if (hostname.length > 253) {
    return { ok: false, error: "主机名超过 253 个字符" };
  }
  for (const character of hostname) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x21 || codePoint === 0x7f || FORBIDDEN_HOSTNAME_CHARACTER.test(character)) {
      return { ok: false, error: "主机名包含不安全字符" };
    }
  }
  return { ok: true, hostname };
}

export function safeErrorText(value: unknown, fallback = "未知错误"): string {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  const compact = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (compact || fallback).slice(0, 180);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
