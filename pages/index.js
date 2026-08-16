"use strict";

const STATUS_RPC = "plugin:onani.hostname.status";
const REFRESH_RPC = "plugin:onani.hostname.refresh";

const elements = {
  error: document.getElementById("error"),
  progress: document.getElementById("progress"),
  nodeCount: document.getElementById("node-count"),
  cachedCount: document.getElementById("cached-count"),
  onlineCount: document.getElementById("online-count"),
  cacheDays: document.getElementById("cache-days"),
  hostnameTabCount: document.getElementById("hostname-tab-count"),
  search: document.getElementById("hostname-search"),
  onlineFilter: document.getElementById("online-filter"),
  cacheFilter: document.getElementById("cache-filter"),
  clearFilters: document.getElementById("clear-filters"),
  resultCount: document.getElementById("result-count"),
  tableWrap: document.getElementById("table-wrap"),
  list: document.getElementById("node-list"),
  empty: document.getElementById("empty"),
  emptyTitle: document.getElementById("empty-title"),
  emptyDescription: document.getElementById("empty-description"),
  emptyClear: document.getElementById("empty-clear"),
  refreshDue: document.getElementById("refresh-due"),
  forceAll: document.getElementById("force-all"),
};

let rpcId = 0;
let loading = false;
let timer = null;
let renderFrame = null;
let lastViewFingerprint = "";
let viewState = { nodes: {}, statuses: {}, pluginStatus: {} };
let localBulkPending = false;
const localPendingUuids = new Set();
const renderedRows = new Map();
const renderedRowFingerprints = new Map();
const rowButtons = new WeakMap();
const noticeHideTimers = new WeakMap();

async function rpc(method, params, options = {}) {
  const response = await fetch("/api/rpc2", {
    method: "POST",
    credentials: "same-origin",
    keepalive: options.keepalive === true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "RPC 请求失败");
  return payload.result;
}

function recordOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedStringSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((item) => typeof item === "string").map((item) => item.toLowerCase()));
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function showNotice(element, message) {
  const hideTimer = noticeHideTimers.get(element);
  if (hideTimer !== undefined) {
    clearTimeout(hideTimer);
    noticeHideTimers.delete(element);
  }
  if (element.textContent !== message) element.textContent = message;
  element.classList.remove("leaving");
  element.hidden = false;
}

function hideNotice(element) {
  if (element.hidden || noticeHideTimers.has(element)) return;
  element.classList.add("leaving");
  const delay = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 160;
  const hideTimer = setTimeout(() => {
    element.hidden = true;
    element.classList.remove("leaving");
    noticeHideTimers.delete(element);
  }, delay);
  noticeHideTimers.set(element, hideTimer);
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function isStale(entry, cacheDays) {
  if (!entry || !entry.collected_at) return true;
  const timestamp = Date.parse(entry.collected_at);
  return !Number.isFinite(timestamp) || Date.now() - timestamp >= cacheDays * 86400000;
}

function cacheState(entry, cacheDays) {
  if (entry?.last_error) return "failed";
  if (!entry?.hostname) return "missing";
  return isStale(entry, cacheDays) ? "expired" : "cached";
}

function cacheBadge(entry, state) {
  if (state === "failed") {
    const badge = textElement("span", "badge error", entry?.hostname ? "刷新失败" : "采集失败");
    badge.title = entry?.last_error || "主机名采集失败";
    return badge;
  }
  if (state === "cached") return textElement("span", "badge ok", "已缓存");
  if (state === "expired") return textElement("span", "badge", "已过期");
  return textElement("span", "badge", "未采集");
}

function nodeRows(nodes, statuses, entries, cacheDays) {
  return Object.entries(nodes)
    .map(([uuid, rawNode]) => {
      const node = recordOrEmpty(rawNode);
      const normalizedUuid = uuid.toLowerCase();
      const entry = recordOrEmpty(entries[uuid] ?? entries[normalizedUuid]);
      const status = recordOrEmpty(statuses[uuid] ?? statuses[normalizedUuid]);
      const name = typeof node.name === "string" && node.name.trim() ? node.name : uuid;
      return {
        uuid,
        node,
        name,
        entry,
        online: status.online === true,
        cacheState: cacheState(entry, cacheDays),
        weight: Number.isFinite(node.weight) ? node.weight : 0,
      };
    })
    .sort((left, right) => left.weight - right.weight || left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
}

function activeFilters() {
  return {
    query: elements.search.value.trim().toLowerCase(),
    online: elements.onlineFilter.value,
    cache: elements.cacheFilter.value,
  };
}

function filterRows(rows, filters) {
  return rows.filter((row) => {
    if (filters.online === "online" && !row.online) return false;
    if (filters.online === "offline" && row.online) return false;
    if (filters.cache !== "all" && row.cacheState !== filters.cache) return false;
    if (!filters.query) return true;
    const searchable = `${row.name}\n${row.entry.hostname || ""}\n${row.uuid}`.toLowerCase();
    return searchable.includes(filters.query);
  });
}

function viewFingerprint(nodes, statuses, pluginStatus) {
  const safePluginStatus = recordOrEmpty(pluginStatus);
  const entries = recordOrEmpty(safePluginStatus.entries);
  const config = recordOrEmpty(safePluginStatus.config);
  const refresh = recordOrEmpty(safePluginStatus.refresh);
  const cacheDays = Number(config.cache_days) || 30;
  const rows = nodeRows(recordOrEmpty(nodes), recordOrEmpty(statuses), entries, cacheDays);
  const activeUuids = [...normalizedStringSet(refresh.active_uuids)].sort();
  const queuedUuids = [...normalizedStringSet(refresh.queued_uuids)].sort();

  return JSON.stringify([
    cacheDays,
    refresh.running === true,
    refresh.bulk_running === true,
    activeUuids,
    queuedUuids,
    typeof refresh.message === "string" ? refresh.message : "",
    rows.map((row) => [
      row.uuid,
      row.name,
      row.weight,
      row.online,
      row.cacheState,
      row.entry.hostname || "",
      row.entry.collected_at || "",
      row.entry.last_attempt_at || "",
      row.entry.last_error || "",
    ]),
  ]);
}

function scheduleRender() {
  if (renderFrame !== null) return;
  const requestFrame = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 16);
  renderFrame = requestFrame(() => {
    renderFrame = null;
    renderCurrentView();
  });
}

function rowFingerprint(row) {
  return JSON.stringify([
    row.uuid,
    row.name,
    row.weight,
    row.online,
    row.cacheState,
    row.entry.hostname || "",
    row.entry.collected_at || "",
    row.entry.last_attempt_at || "",
    row.entry.last_error || "",
  ]);
}

function renderRow(row, taskState) {
  const tableRow = document.createElement("tr");

  const nodeCell = document.createElement("td");
  nodeCell.append(textElement("span", "node-name", row.name));
  nodeCell.append(textElement("span", "node-id", row.uuid));
  tableRow.append(nodeCell);

  const hostnameCell = document.createElement("td");
  hostnameCell.append(textElement("span", row.entry.hostname ? "hostname" : "muted", row.entry.hostname || "—"));
  tableRow.append(hostnameCell);

  const statusCell = document.createElement("td");
  statusCell.append(cacheBadge(row.entry, row.cacheState));
  statusCell.append(document.createTextNode(" "));
  statusCell.append(textElement("span", row.online ? "badge online" : "badge", row.online ? "在线" : "离线"));
  if (row.entry.last_error) statusCell.title = row.entry.last_error;
  tableRow.append(statusCell);

  const timeCell = textElement("td", "muted", formatTime(row.entry.collected_at));
  if (row.entry.last_attempt_at) timeCell.title = `最近尝试：${formatTime(row.entry.last_attempt_at)}`;
  tableRow.append(timeCell);

  const actionCell = document.createElement("td");
  actionCell.className = "action-column";
  const button = textElement("button", "button small", "强制刷新");
  button.type = "button";
  button.addEventListener("click", () => void startRefresh({ force: true, uuids: [row.uuid] }));
  actionCell.append(button);
  tableRow.append(actionCell);
  rowButtons.set(tableRow, button);
  updateRowButton(tableRow, row, taskState);

  return tableRow;
}

function updateRowButton(tableRow, row, taskState) {
  const button = rowButtons.get(tableRow);
  if (!button) return;

  const label = taskState === "active" ? "刷新中" : taskState === "queued" ? "排队中" : "强制刷新";
  const disabled = taskState !== null || !row.online;
  const title = taskState === "active"
    ? "正在刷新这个节点的主机名"
    : taskState === "queued"
      ? "这个节点正在等待刷新"
      : row.online
        ? "强制刷新这个节点的主机名"
        : "节点离线时不能刷新主机名";

  if (button.textContent !== label) button.textContent = label;
  if (button.disabled !== disabled) button.disabled = disabled;
  if (button.title !== title) button.title = title;
  button.className = taskState === null ? "button small" : "button small busy";
}

function renderedRow(row, taskState) {
  const fingerprint = rowFingerprint(row);
  const previous = renderedRows.get(row.uuid);
  let tableRow = previous;

  if (!tableRow || renderedRowFingerprints.get(row.uuid) !== fingerprint) {
    tableRow = renderRow(row, taskState);
    if (previous) tableRow.className = "row-updated";
    renderedRows.set(row.uuid, tableRow);
    renderedRowFingerprints.set(row.uuid, fingerprint);
  }

  updateRowButton(tableRow, row, taskState);
  return tableRow;
}

function reconcileRows(rows, visibleRows, activeUuids, queuedUuids) {
  const desiredRows = visibleRows.map((row) => {
    const uuid = row.uuid.toLowerCase();
    const taskState = activeUuids.has(uuid)
      ? "active"
      : queuedUuids.has(uuid) || localPendingUuids.has(uuid)
        ? "queued"
        : null;
    return renderedRow(row, taskState);
  });
  const desiredSet = new Set(desiredRows);

  for (const current of Array.from(elements.list.children)) {
    if (!desiredSet.has(current)) elements.list.removeChild(current);
  }

  for (let index = 0; index < desiredRows.length; index += 1) {
    const desired = desiredRows[index];
    const current = elements.list.children[index] || null;
    if (current !== desired) elements.list.insertBefore(desired, current);
  }

  const currentUuids = new Set(rows.map((row) => row.uuid));
  for (const uuid of renderedRows.keys()) {
    if (currentUuids.has(uuid)) continue;
    renderedRows.delete(uuid);
    renderedRowFingerprints.delete(uuid);
  }
}

function renderEmptyState(total, visible, hasFilters) {
  const isEmpty = visible === 0;
  elements.tableWrap.hidden = isEmpty;
  elements.empty.hidden = !isEmpty;
  if (!isEmpty) return;

  if (total === 0) {
    elements.emptyTitle.textContent = "暂无节点";
    elements.emptyDescription.textContent = "Komari 当前没有可显示的节点。";
    elements.emptyClear.hidden = true;
    return;
  }

  elements.emptyTitle.textContent = "没有匹配的节点";
  elements.emptyDescription.textContent = "请调整搜索关键词或筛选条件。";
  elements.emptyClear.hidden = !hasFilters;
}

function renderCurrentView() {
  const nodes = recordOrEmpty(viewState.nodes);
  const statuses = recordOrEmpty(viewState.statuses);
  const pluginStatus = recordOrEmpty(viewState.pluginStatus);
  const entries = recordOrEmpty(pluginStatus.entries);
  const refresh = recordOrEmpty(pluginStatus.refresh);
  const config = recordOrEmpty(pluginStatus.config);
  const cacheDays = Number(config.cache_days) || 30;
  const rows = nodeRows(nodes, statuses, entries, cacheDays);
  const filters = activeFilters();
  const visibleRows = filterRows(rows, filters);
  const hasFilters = Boolean(filters.query) || filters.online !== "all" || filters.cache !== "all";
  const onlineCount = rows.filter((row) => row.online).length;
  const cachedCount = rows.filter((row) => Boolean(row.entry.hostname)).length;
  const running = refresh.running === true;
  const activeUuids = normalizedStringSet(refresh.active_uuids);
  const queuedUuids = normalizedStringSet(refresh.queued_uuids);
  const bulkRunning = refresh.bulk_running === true || localBulkPending;

  elements.nodeCount.textContent = String(rows.length);
  elements.cachedCount.textContent = String(cachedCount);
  elements.onlineCount.textContent = String(onlineCount);
  elements.cacheDays.textContent = `${cacheDays} 天`;
  elements.hostnameTabCount.textContent = String(rows.length);
  elements.resultCount.textContent = visibleRows.length === rows.length
    ? `${rows.length} 个节点`
    : `显示 ${visibleRows.length} / ${rows.length}`;
  elements.clearFilters.hidden = !hasFilters;
  elements.refreshDue.disabled = bulkRunning || onlineCount === 0;
  elements.forceAll.disabled = bulkRunning || onlineCount === 0;

  if (running) showNotice(elements.progress, refresh.message || "正在采集主机名");
  else hideNotice(elements.progress);

  reconcileRows(rows, visibleRows, activeUuids, queuedUuids);
  renderEmptyState(rows.length, visibleRows.length, hasFilters);
}

function clearFilters() {
  elements.search.value = "";
  elements.onlineFilter.value = "all";
  elements.cacheFilter.value = "all";
  renderCurrentView();
  elements.search.focus();
}

async function loadView() {
  if (loading || document.hidden) return;
  loading = true;
  try {
    const [nodes, statuses, pluginStatus] = await Promise.all([
      rpc("common:getNodes"),
      rpc("common:getNodesLatestStatus"),
      rpc(STATUS_RPC),
    ]);
    viewState = { nodes, statuses, pluginStatus };
    hideNotice(elements.error);
    const fingerprint = viewFingerprint(nodes, statuses, pluginStatus);
    if (fingerprint !== lastViewFingerprint) {
      lastViewFingerprint = fingerprint;
      renderCurrentView();
    }
    schedule(pluginStatus?.refresh?.running ? 1500 : 15000);
  } catch (error) {
    showNotice(elements.error, error instanceof Error ? error.message : "读取插件状态失败");
    schedule(10000);
  } finally {
    loading = false;
  }
}

function schedule(delay) {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(loadView, delay);
}

async function startRefresh(params) {
  const input = recordOrEmpty(params);
  const hasUuids = Object.prototype.hasOwnProperty.call(input, "uuids");
  const requestUuids = normalizedStringSet(input.uuids);
  if (!hasUuids && localBulkPending) return;
  if (hasUuids && [...requestUuids].every((uuid) => localPendingUuids.has(uuid))) return;

  if (hasUuids) {
    for (const uuid of requestUuids) localPendingUuids.add(uuid);
  } else {
    localBulkPending = true;
  }

  hideNotice(elements.error);
  renderCurrentView();
  let nextPollDelay = 3000;
  try {
    const result = await rpc(REFRESH_RPC, params, { keepalive: true });
    if (!result?.accepted && !result?.running) throw new Error(result?.message || "无法启动采集");
    const message = result?.message || "主机名刷新任务已加入队列";
    const pluginStatus = recordOrEmpty(viewState.pluginStatus);
    const currentRefresh = recordOrEmpty(pluginStatus.refresh);
    viewState = {
      ...viewState,
      pluginStatus: {
        ...pluginStatus,
        refresh: {
          ...currentRefresh,
          running: result?.running === true,
          message,
          active_uuids: Array.isArray(result?.active_uuids) ? result.active_uuids : currentRefresh.active_uuids,
          queued_uuids: Array.isArray(result?.queued_uuids) ? result.queued_uuids : currentRefresh.queued_uuids,
          bulk_running: result?.bulk_running === true,
          active_jobs: result?.active_jobs,
          queued_jobs: result?.queued_jobs,
          max_concurrent_jobs: result?.max_concurrent_jobs,
        },
      },
    };
    nextPollDelay = 250;
  } catch (error) {
    showNotice(elements.error, error instanceof Error ? error.message : "启动采集失败");
  } finally {
    if (hasUuids) {
      for (const uuid of requestUuids) localPendingUuids.delete(uuid);
    } else {
      localBulkPending = false;
    }
    renderCurrentView();
    schedule(nextPollDelay);
  }
}

elements.search.addEventListener("input", scheduleRender);
elements.onlineFilter.addEventListener("change", scheduleRender);
elements.cacheFilter.addEventListener("change", scheduleRender);
elements.clearFilters.addEventListener("click", clearFilters);
elements.emptyClear.addEventListener("click", clearFilters);
elements.refreshDue.addEventListener("click", () => void startRefresh({ force: false }));
elements.forceAll.addEventListener("click", () => {
  if (window.confirm("强制刷新会对全部在线节点各执行一次固定命令 hostname，是否继续？")) {
    void startRefresh({ force: true });
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void loadView();
});

void loadView();
