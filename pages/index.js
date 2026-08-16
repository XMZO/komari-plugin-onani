"use strict";

const STATUS_RPC = "plugin:onani.hostname.status";
const REFRESH_RPC = "plugin:onani.hostname.refresh";
const PLUGIN_SHORT = "onani";
const CURRENT_VERSION = "0.1.7";
const UPDATE_SOURCE_NAME = "Onani Updates";
const UPDATE_SOURCE_URL = "https://github.com/XMZO/komari-plugin-onani/releases/latest/download/onani-update.json";
const PLUGIN_MARKET_API = "/api/admin/plugin/market";
const UPDATE_CHECK_TIMEOUT_MS = 20_000;
const UPDATE_INSTALL_TIMEOUT_MS = 60_000;
const UPDATE_RELOAD_MARKER = "onani:updated-version";

const elements = {
  error: document.getElementById("error"),
  updateError: document.getElementById("update-error"),
  progress: document.getElementById("progress"),
  updateCard: document.getElementById("update-card"),
  updateCurrent: document.getElementById("update-current"),
  updateStatus: document.getElementById("update-status"),
  updateAction: document.getElementById("update-action"),
  confirmDialog: document.getElementById("confirm-dialog"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmMessage: document.getElementById("confirm-message"),
  confirmCancel: document.getElementById("confirm-cancel"),
  confirmAccept: document.getElementById("confirm-accept"),
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
let updateBusy = false;
let updateMode = "idle";
let updateMessage = "仅在点击时检查 GitHub Release";
let currentVersion = CURRENT_VERSION;
let availableUpdate = null;
let pendingConfirmation = null;
const localPendingUuids = new Set();
const renderedRows = new Map();
const renderedRowFingerprints = new Map();
const rowButtons = new WeakMap();
const noticeHideTimers = new WeakMap();

async function fetchWithDeadline(resource, init, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(resource, init);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...init, signal: controller.signal });
  } catch (error) {
    if (error && typeof error === "object" && error.name === "AbortError") {
      throw new Error(`${label}超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function rpc(method, params, options = {}) {
  const response = await fetchWithDeadline("/api/rpc2", {
    method: "POST",
    credentials: "same-origin",
    keepalive: options.keepalive === true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  }, Number(options.timeoutMs) || 0, "RPC 请求");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "RPC 请求失败");
  return payload.result;
}

async function adminRequest(path, options = {}) {
  const method = options.method || "GET";
  const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
  const response = await fetchWithDeadline(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    keepalive: options.keepalive === true,
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  }, Number(options.timeoutMs) || UPDATE_CHECK_TIMEOUT_MS, options.label || "更新请求");
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok ? "Komari 返回了无效的更新响应" : `HTTP ${response.status}`);
  }
  if (!response.ok || payload?.status !== "success") {
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return payload.data;
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

function settleConfirmation(approved) {
  const resolve = pendingConfirmation;
  if (!resolve) return;
  pendingConfirmation = null;
  if (typeof elements.confirmDialog.close === "function" && elements.confirmDialog.open) {
    elements.confirmDialog.close();
  } else {
    elements.confirmDialog.removeAttribute("open");
  }
  resolve(approved);
}

function requestConfirmation({ title, message, confirmLabel = "继续" }) {
  if (pendingConfirmation) return Promise.resolve(false);
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmAccept.textContent = confirmLabel;

  return new Promise((resolve) => {
    pendingConfirmation = resolve;
    try {
      if (typeof elements.confirmDialog.showModal === "function") elements.confirmDialog.showModal();
      else elements.confirmDialog.setAttribute("open", "");
      elements.confirmCancel.focus();
    } catch {
      pendingConfirmation = null;
      showNotice(elements.error, "无法打开确认窗口，请刷新页面后重试");
      resolve(false);
    }
  });
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

function renderUpdater() {
  elements.updateCurrent.textContent = `v${currentVersion}`;
  elements.updateStatus.textContent = updateMessage;
  elements.updateStatus.title = updateMessage;
  elements.updateCard.classList.remove("available", "error");
  elements.updateAction.className = "button small update-action";

  const busy = updateBusy || updateMode === "checking" || updateMode === "installing" || updateMode === "installed";
  let label = "检查更新";
  if (updateMode === "available" && availableUpdate) {
    label = `更新到 v${availableUpdate.version}`;
    elements.updateCard.classList.add("available");
    elements.updateAction.classList.add("primary");
  } else if (updateMode === "checking") {
    label = "检查中";
  } else if (updateMode === "installing") {
    label = "正在更新";
  } else if (updateMode === "installed") {
    label = "正在重载";
  } else if (updateMode === "current" || updateMode === "ahead") {
    label = "再次检查";
  } else if (updateMode === "error") {
    label = "重试";
    elements.updateCard.classList.add("error");
  }
  elements.updateAction.textContent = label;
  elements.updateAction.disabled = busy;
  if (busy) elements.updateAction.classList.add("busy");
}

function setUpdater(mode, message, update = null) {
  updateMode = mode;
  updateMessage = message;
  availableUpdate = update;
  renderUpdater();
}

function sourceWithURL(sources) {
  if (!Array.isArray(sources)) return null;
  return sources.find((source) => source && typeof source === "object" && source.url === UPDATE_SOURCE_URL) || null;
}

async function listUpdateSources() {
  const sources = await adminRequest(`${PLUGIN_MARKET_API}/sources`, { label: "读取更新源" });
  if (!Array.isArray(sources)) throw new Error("Komari 返回了无效的更新源列表");
  return sources;
}

async function ensureUpdateSource() {
  let source = sourceWithURL(await listUpdateSources());
  if (source && source.enabled === true) return source;

  if (source) {
    const approved = await requestConfirmation({
      title: "重新启用更新源",
      message: "Onani 更新源已被停用。重新启用后才可继续检查 GitHub Release。",
      confirmLabel: "启用并检查",
    });
    if (!approved) return null;
    return adminRequest(`${PLUGIN_MARKET_API}/sources/${encodeURIComponent(source.id)}`, {
      method: "PUT",
      body: {
        name: typeof source.name === "string" && source.name.trim() ? source.name : UPDATE_SOURCE_NAME,
        url: UPDATE_SOURCE_URL,
        enabled: true,
      },
      label: "启用更新源",
    });
  }

  try {
    return await adminRequest(`${PLUGIN_MARKET_API}/sources`, {
      method: "POST",
      body: { name: UPDATE_SOURCE_NAME, url: UPDATE_SOURCE_URL, enabled: true },
      label: "添加更新源",
    });
  } catch (error) {
    const existing = sourceWithURL(await listUpdateSources().catch(() => []));
    if (existing?.enabled === true) return existing;
    throw error;
  }
}

function installedVersion(plugins) {
  if (!Array.isArray(plugins)) return CURRENT_VERSION;
  const installed = plugins.find(
    (plugin) => plugin && typeof plugin === "object" && String(plugin.short || "").toLowerCase() === PLUGIN_SHORT,
  );
  return typeof installed?.version === "string" && installed.version.trim() ? installed.version.trim() : CURRENT_VERSION;
}

async function checkForUpdates() {
  if (updateBusy) return;
  updateBusy = true;
  hideNotice(elements.updateError);
  setUpdater("checking", "正在读取自有更新源", null);
  try {
    const source = await ensureUpdateSource();
    if (!source) {
      setUpdater("idle", "已取消检查；未更改更新源", null);
      return;
    }
    if (typeof source.id !== "string" || !source.id) throw new Error("更新源缺少有效 ID");

    const [catalog, installedPlugins] = await Promise.all([
      adminRequest(`${PLUGIN_MARKET_API}/catalog?refresh=true`, { label: "检查 GitHub Release" }),
      rpc("admin:listPlugins", undefined, { timeoutMs: 10_000 }),
    ]);
    const catalogData = recordOrEmpty(catalog);
    const sourceStatus = Array.isArray(catalogData.sources)
      ? catalogData.sources.find((item) => item?.id === source.id)
      : null;
    if (sourceStatus?.error) throw new Error(`更新源不可用：${sourceStatus.error}`);

    const latest = Array.isArray(catalogData.plugins)
      ? catalogData.plugins.find(
        (plugin) => plugin?.source_id === source.id && String(plugin?.short || "").toLowerCase() === PLUGIN_SHORT,
      )
      : null;
    if (!latest || typeof latest.version !== "string") throw new Error("更新源中没有找到 Onani 安装包");
    if (latest.installable !== true) {
      throw new Error(`v${latest.version} 与当前 Komari 不兼容，或 Release 缺少可校验的安装包`);
    }

    currentVersion = installedVersion(installedPlugins);
    const comparison = compareSemver(latest.version, currentVersion);
    if (comparison === null) throw new Error("更新源返回了无法识别的版本号");
    if (comparison > 0) {
      setUpdater("available", `发现新版本 v${latest.version}`, { sourceId: source.id, version: latest.version });
    } else if (comparison === 0) {
      setUpdater("current", "已是最新正式版本", null);
    } else {
      setUpdater("ahead", `当前版本高于更新源 v${latest.version}`, null);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "检查更新失败";
    setUpdater("error", "检查更新失败", null);
    showNotice(elements.updateError, message);
  } finally {
    updateBusy = false;
    renderUpdater();
  }
}

async function refreshUpdatedAssets() {
  const assets = ["./index.css", "./index.js"];
  await Promise.allSettled(assets.map(async (asset) => {
    const response = await fetchWithDeadline(new URL(asset, window.location.href), {
      method: "GET",
      credentials: "same-origin",
      cache: "reload",
    }, 8_000, "刷新页面资源");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }));
}

async function installAvailableUpdate() {
  if (updateBusy || !availableUpdate) return;
  const target = availableUpdate;
  const approved = await requestConfirmation({
    title: `更新到 v${target.version}`,
    message: `Komari 将从 GitHub Release 更新 Onani（当前 v${currentVersion}）。插件配置和主机名缓存会保留。`,
    confirmLabel: "开始更新",
  });
  if (!approved) return;

  updateBusy = true;
  hideNotice(elements.updateError);
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  setUpdater("installing", "Komari 正在下载、校验并安装", target);
  let reloading = false;
  try {
    const installed = recordOrEmpty(await adminRequest(`${PLUGIN_MARKET_API}/install`, {
      method: "POST",
      body: { source_id: target.sourceId, short: PLUGIN_SHORT },
      timeoutMs: UPDATE_INSTALL_TIMEOUT_MS,
      label: "安装更新",
      keepalive: true,
    }));
    if (String(installed.short || "").toLowerCase() !== PLUGIN_SHORT || typeof installed.version !== "string") {
      throw new Error("Komari 安装结果与 Onani 不匹配");
    }
    const installedComparison = compareSemver(installed.version, target.version);
    if (installedComparison === null || installedComparison < 0) {
      throw new Error("Komari 安装结果低于确认的目标版本");
    }

    currentVersion = installed.version;
    setUpdater("installed", `已安装 v${installed.version}，正在重新载入`, null);
    await refreshUpdatedAssets();
    try {
      window.sessionStorage?.setItem(UPDATE_RELOAD_MARKER, installed.version);
    } catch {
      // Storage may be disabled; reloading still activates the new files.
    }
    reloading = true;
    window.location.reload();
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : "更新失败";
    const permissionChanged = /permission|approval|权限/i.test(rawMessage);
    const message = permissionChanged
      ? "新版已写入，但权限声明发生变化；请回到插件管理重新启用并批准权限。"
      : rawMessage;
    setUpdater("error", "更新未完成", null);
    showNotice(elements.updateError, message);
  } finally {
    if (!reloading) {
      updateBusy = false;
      renderUpdater();
      schedule(3000);
    }
  }
}

function consumeUpdateReloadMarker() {
  try {
    const updatedVersion = window.sessionStorage?.getItem(UPDATE_RELOAD_MARKER);
    window.sessionStorage?.removeItem(UPDATE_RELOAD_MARKER);
    if (updatedVersion === CURRENT_VERSION) {
      currentVersion = CURRENT_VERSION;
      setUpdater("current", `已成功更新到 v${CURRENT_VERSION}`, null);
    }
  } catch {
    // A blocked session store only suppresses the one-time success message.
  }
}

async function handleUpdateAction() {
  if (updateMode === "available" && availableUpdate) await installAvailableUpdate();
  else await checkForUpdates();
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
  if (loading || document.hidden || updateMode === "installing" || updateMode === "installed") return;
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
elements.updateAction.addEventListener("click", () => void handleUpdateAction());
elements.refreshDue.addEventListener("click", () => void startRefresh({ force: false }));
elements.forceAll.addEventListener("click", async () => {
  const approved = await requestConfirmation({
    title: "强制刷新全部在线节点",
    message: "将对每个在线节点执行一次固定命令 hostname。正在运行或排队的节点不会重复加入。",
    confirmLabel: "开始刷新",
  });
  if (approved) void startRefresh({ force: true });
});
elements.confirmCancel.addEventListener("click", () => settleConfirmation(false));
elements.confirmAccept.addEventListener("click", () => settleConfirmation(true));
elements.confirmDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  settleConfirmation(false);
});
elements.confirmDialog.addEventListener("close", () => settleConfirmation(false));
elements.confirmDialog.addEventListener("click", (event) => {
  if (event.target === elements.confirmDialog) settleConfirmation(false);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void loadView();
});

renderUpdater();
consumeUpdateReloadMarker();
void loadView();
