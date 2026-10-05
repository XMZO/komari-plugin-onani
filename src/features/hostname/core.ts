export const HOSTNAME_CACHE_SCHEMA = 1 as const;
export const DEFAULT_CACHE_DAYS = 30;
export const MIN_CACHE_DAYS = 1;
export const MAX_CACHE_DAYS = 3650;
export const RETRY_BACKOFF_MS = 24 * 60 * 60 * 1000;
export const HOSTNAME_COMMAND = "hostname";
// Minimal BusyBox builds (OpenWrt/ImmortalWrt) often omit the hostname applet but keep uname.
export const FALLBACK_HOSTNAME_COMMAND = "uname -n";
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

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
  last_failure?: HostnameFailure;
};

export type HostnameFailure = {
  stage: string;
  at: string;
  task_id?: string;
  rpc_code?: number;
  exit_code?: number;
  output?: string;
};

export function normalizeFailure(value: unknown): HostnameFailure | undefined {
  if (!isRecord(value) || typeof value.stage !== "string" || !validIsoTimestamp(value.at)) return undefined;
  const failure: HostnameFailure = { stage: safeErrorText(value.stage), at: value.at };
  if (typeof value.task_id === "string" && value.task_id.trim()) failure.task_id = safeErrorText(value.task_id).slice(0, 128);
  if (typeof value.rpc_code === "number" && Number.isSafeInteger(value.rpc_code)) failure.rpc_code = value.rpc_code;
  if (typeof value.exit_code === "number" && Number.isSafeInteger(value.exit_code)) failure.exit_code = value.exit_code;
  if (typeof value.output === "string" && value.output.trim()) failure.output = safeResultOutput(value.output);
  return failure;
}

export function safeResultOutput(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 2048);
}

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
    entry.last_failure = normalizeFailure(value.last_failure);
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

// Only a POSIX shell's "command not found" for the primary command triggers the fallback;
// Windows agents run PowerShell, which never reports 127 for a missing command.
export function shouldUseHostnameFallback(command: string, exitCode: number): boolean {
  return command === HOSTNAME_COMMAND && exitCode === COMMAND_NOT_FOUND_EXIT_CODE;
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
  const text = value instanceof Error ? value.message : typeof value === "string" ? value
    : isRecord(value) && typeof value.message === "string" ? value.message : fallback;
  const compact = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return (compact || fallback).slice(0, 512);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
