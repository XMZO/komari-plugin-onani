"use strict";

// Pure view logic for the admin page. No DOM access, so tests can run it in Node
// and index.js only has to turn these values into elements.
(function exposeModel(root) {
  const DAY_MS = 86_400_000;
  const RPC_METHOD_NOT_FOUND = -32601;
  const FILTERS = ["all", "cached", "failed", "missing", "expired", "offline"];
  const STATE_LABELS = { cached: "正常", expired: "已过期", missing: "未采集", failed: "采集失败" };
  const REGIONAL_INDICATOR_A = 0x1f1e6;

  const relativeFormat = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  const fullFormat = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const shortFormat = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const nameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

  function recordOrEmpty(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function timestamp(value) {
    if (typeof value !== "string" || !value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function lowerSet(value) {
    if (value instanceof Set) return value;
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((item) => typeof item === "string").map((item) => item.toLowerCase()));
  }

  function parseSemver(value) {
    if (typeof value !== "string") return null;
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value.trim());
    if (!match) return null;
    const core = match.slice(1, 4).map(Number);
    if (core.some((part) => !Number.isSafeInteger(part))) return null;
    const prerelease = match[4] ? match[4].split(".") : [];
    if (prerelease.some((part) => /^\d+$/.test(part) && !/^(0|[1-9]\d*)$/.test(part))) return null;
    return { core, prerelease };
  }

  function compareSemver(leftValue, rightValue) {
    const left = parseSemver(leftValue);
    const right = parseSemver(rightValue);
    if (!left || !right) return null;
    for (let index = 0; index < left.core.length; index += 1) {
      if (left.core[index] !== right.core[index]) return left.core[index] > right.core[index] ? 1 : -1;
    }
    if (left.prerelease.length === 0 || right.prerelease.length === 0) {
      if (left.prerelease.length === right.prerelease.length) return 0;
      return left.prerelease.length === 0 ? 1 : -1;
    }
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
      const leftPart = left.prerelease[index];
      const rightPart = right.prerelease[index];
      if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
      if (leftPart === rightPart) continue;
      const leftNumeric = /^(0|[1-9]\d*)$/.test(leftPart);
      const rightNumeric = /^(0|[1-9]\d*)$/.test(rightPart);
      if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
      if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
      return leftPart > rightPart ? 1 : -1;
    }
    return 0;
  }

  // Komari stores regions as flag emoji, which Windows renders as bare letters anyway;
  // a two-letter code reads the same everywhere and fits a fixed-width badge.
  function regionCode(value) {
    const region = text(value);
    const points = Array.from(region, (character) => character.codePointAt(0));
    if (points.length === 2 && points.every((point) => point >= REGIONAL_INDICATOR_A && point < REGIONAL_INDICATOR_A + 26)) {
      return String.fromCharCode(...points.map((point) => point - REGIONAL_INDICATOR_A + 65));
    }
    return /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : "";
  }

  function shortUuid(uuid) {
    return typeof uuid === "string" ? uuid.slice(0, 8) : "";
  }

  function cacheState(entry, cacheDays, now) {
    const safeEntry = recordOrEmpty(entry);
    if (text(safeEntry.last_error)) return "failed";
    if (!text(safeEntry.hostname)) return "missing";
    const collectedAt = timestamp(safeEntry.collected_at);
    return collectedAt === null || now - collectedAt >= cacheDays * DAY_MS ? "expired" : "cached";
  }

  function normalizeFailure(value) {
    const failure = recordOrEmpty(value);
    if (!text(failure.stage)) return null;
    return {
      stage: text(failure.stage),
      at: timestamp(failure.at),
      taskId: text(failure.task_id),
      rpcCode: Number.isInteger(failure.rpc_code) ? failure.rpc_code : null,
      exitCode: Number.isInteger(failure.exit_code) ? failure.exit_code : null,
      output: typeof failure.output === "string" ? failure.output : "",
    };
  }

  function buildRows(nodes, statuses, entries, cacheDays, now) {
    const safeNodes = recordOrEmpty(nodes);
    const safeStatuses = recordOrEmpty(statuses);
    const safeEntries = recordOrEmpty(entries);
    const rows = [];
    for (const [mapKey, rawNode] of Object.entries(safeNodes)) {
      const node = recordOrEmpty(rawNode);
      const uuid = text(node.uuid) || mapKey;
      const key = uuid.toLowerCase();
      const entry = recordOrEmpty(safeEntries[mapKey] ?? safeEntries[key] ?? safeEntries[uuid]);
      const status = recordOrEmpty(safeStatuses[mapKey] ?? safeStatuses[key] ?? safeStatuses[uuid]);
      rows.push({
        uuid,
        key,
        name: text(node.name) || uuid,
        region: regionCode(node.region),
        weight: Number.isFinite(node.weight) ? node.weight : 0,
        online: status.online === true,
        hostname: text(entry.hostname),
        collectedAt: timestamp(entry.collected_at),
        attemptAt: timestamp(entry.last_attempt_at),
        error: text(entry.last_error),
        failure: normalizeFailure(entry.last_failure),
        state: cacheState(entry, cacheDays, now),
        os: text(node.os),
        version: text(node.version),
      });
    }
    return rows.sort((left, right) => left.weight - right.weight || nameCollator.compare(left.name, right.name) || left.key.localeCompare(right.key));
  }

  function summarize(rows) {
    const counts = { all: rows.length, cached: 0, failed: 0, missing: 0, expired: 0, offline: 0, online: 0 };
    for (const row of rows) {
      counts[row.state] += 1;
      if (row.online) counts.online += 1;
      else counts.offline += 1;
    }
    return counts;
  }

  function normalizeFilter(value) {
    return FILTERS.includes(value) ? value : "all";
  }

  function queryTerms(query) {
    return typeof query === "string" ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  }

  // Every whitespace-separated term must match; a bare two-letter term also matches
  // the region code so "hk" lists Hong Kong nodes.
  function matchesQuery(row, terms) {
    if (terms.length === 0) return true;
    const haystack = `${row.name}\n${row.hostname}\n${row.uuid}`.toLowerCase();
    const region = row.region.toLowerCase();
    return terms.every((term) => haystack.includes(term) || (region !== "" && term === region));
  }

  function matchesFilter(row, filter) {
    if (filter === "all") return true;
    if (filter === "offline") return !row.online;
    return row.state === filter;
  }

  function filterRows(rows, filter, query) {
    const safeFilter = normalizeFilter(filter);
    const terms = queryTerms(query);
    return rows.filter((row) => matchesFilter(row, safeFilter) && matchesQuery(row, terms));
  }

  // Everything that changes what a row shows; relative times are refreshed separately.
  function rowSignature(row) {
    const failure = row.failure;
    return JSON.stringify([
      row.name, row.region, row.online, row.state, row.hostname, row.collectedAt, row.attemptAt, row.error,
      failure ? [failure.stage, failure.at, failure.taskId, failure.rpcCode, failure.exitCode, failure.output] : null,
      row.os, row.version,
    ]);
  }

  function taskStateOf(key, refresh, localPending) {
    const safeRefresh = recordOrEmpty(refresh);
    if (lowerSet(safeRefresh.active_uuids).has(key)) return "active";
    if (lowerSet(safeRefresh.queued_uuids).has(key) || (localPending instanceof Set && localPending.has(key))) return "queued";
    return null;
  }

  function count(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  // Bulk jobs only learn their target count after reading the node list, so the
  // ratio stays null (indeterminate) until there is something to measure.
  function progressOf(refresh) {
    const safeRefresh = recordOrEmpty(refresh);
    const done = count(safeRefresh.succeeded) + count(safeRefresh.failed);
    const total = count(safeRefresh.targeted) + lowerSet(safeRefresh.queued_uuids).size;
    return {
      running: safeRefresh.running === true,
      done,
      total,
      ratio: total > 0 ? Math.min(1, done / total) : null,
      message: text(safeRefresh.message),
    };
  }

  function lastRefresh(refresh) {
    const safeRefresh = recordOrEmpty(refresh);
    const finishedAt = timestamp(safeRefresh.finished_at);
    if (safeRefresh.running === true || finishedAt === null) return null;
    return {
      finishedAt,
      succeeded: count(safeRefresh.succeeded),
      failed: count(safeRefresh.failed),
      targeted: count(safeRefresh.targeted),
      message: text(safeRefresh.message),
    };
  }

  function formatAbsolute(value) {
    return Number.isFinite(value) ? fullFormat.format(value) : "—";
  }

  function formatCompact(value, now) {
    if (!Number.isFinite(value)) return "—";
    return new Date(value).getFullYear() === new Date(now).getFullYear() ? shortFormat.format(value) : fullFormat.format(value);
  }

  function formatRelative(value, now) {
    if (!Number.isFinite(value)) return "—";
    const diff = value - now;
    const seconds = Math.abs(diff) / 1000;
    if (seconds < 45) return diff <= 0 ? "刚刚" : "即将";
    const units = [
      ["minute", 60, 45 * 60],
      ["hour", 3600, 22 * 3600],
      ["day", 86_400, 26 * 86_400],
      ["month", 30 * 86_400, 320 * 86_400],
      ["year", 365 * 86_400, Infinity],
    ];
    for (const [unit, size, limit] of units) {
      if (seconds < limit) return relativeFormat.format(Math.round(diff / 1000 / size) || Math.sign(diff), unit);
    }
    return "—";
  }

  function expiryOf(row, cacheDays) {
    return row.collectedAt === null ? null : row.collectedAt + cacheDays * DAY_MS;
  }

  function stateLabel(row) {
    if (row.state === "failed") return row.hostname ? "刷新失败" : "采集失败";
    return STATE_LABELS[row.state] || "未知";
  }

  function failureReport(row, cacheDays) {
    const failure = row.failure;
    const lines = [
      `节点：${row.name}`,
      `UUID：${row.uuid}`,
      `主机名：${row.hostname || "未获取"}`,
      `在线状态：${row.online ? "在线" : "离线"}`,
      `采集状态：${stateLabel(row)}`,
      `原因：${row.error || "无"}`,
      `失败阶段：${failure?.stage || "旧记录未保存阶段"}`,
      `发生时间：${formatAbsolute(failure?.at ?? row.attemptAt)}`,
      `任务 ID：${failure?.taskId || "尚未下发任务或旧记录未保存"}`,
    ];
    if (failure?.rpcCode !== null && failure?.rpcCode !== undefined) lines.push(`RPC 错误码：${failure.rpcCode}`);
    if (failure?.exitCode !== null && failure?.exitCode !== undefined) lines.push(`退出码：${failure.exitCode}`);
    if (row.version) lines.push(`Agent 版本：${row.version}`);
    if (row.os) lines.push(`系统：${row.os}`);
    lines.push(`缓存周期：${cacheDays} 天`);
    if (failure?.output) lines.push(`Agent 原始输出（最多 2048 字符）：\n${failure.output}`);
    if (!failure) lines.push("重新刷新可记录更完整的任务信息。");
    return lines.join("\n");
  }

  function describeError(error, fallback) {
    const safe = recordOrEmpty(error);
    if (safe.code === RPC_METHOD_NOT_FOUND) {
      return { kind: "not-running", message: "Onani 插件当前未运行：可能已停用，或升级后正在等待批准新权限。" };
    }
    if (safe.status === 401 || safe.status === 403) {
      return { kind: "auth", message: "登录状态已失效，请重新登录 Komari 后台后刷新本页。" };
    }
    const message = typeof safe.message === "string" && safe.message.trim() ? safe.message.trim() : fallback;
    if (error instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(message)) {
      return { kind: "network", message: "无法连接 Komari，请检查网络后重试。" };
    }
    return { kind: "error", message };
  }

  root.OnaniModel = Object.freeze({
    DAY_MS,
    FILTERS,
    buildRows,
    cacheState,
    compareSemver,
    describeError,
    expiryOf,
    failureReport,
    filterRows,
    formatAbsolute,
    formatCompact,
    formatRelative,
    lastRefresh,
    lowerSet,
    normalizeFilter,
    parseSemver,
    progressOf,
    recordOrEmpty,
    regionCode,
    rowSignature,
    shortUuid,
    stateLabel,
    summarize,
    taskStateOf,
  });
})(globalThis);
