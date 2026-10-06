"use strict";

(() => {
  const Model = window.OnaniModel;
  // Without the model the static skeleton stays visible instead of a half-wired page.
  if (!Model) return;

  const STATUS_RPC = "plugin:onani.hostname.status";
  const REFRESH_RPC = "plugin:onani.hostname.refresh";
  const PLUGIN_SHORT = "onani";
  const CURRENT_VERSION = "0.3.0";
  const UPDATE_SOURCE_NAME = "Onani Updates";
  const UPDATE_SOURCE_URL = "https://github.com/XMZO/komari-plugin-onani/releases/latest/download/onani-update.json";
  const PLUGIN_MARKET_API = "/api/admin/plugin/market";
  const PAGE_ASSETS = ["./index.css", "./theme.js", "./model.js", "./index.js"];
  const UPDATE_RELOAD_MARKER = "onani:updated-version";
  const LOAD_TIMEOUT_MS = 15_000;
  const ACTION_TIMEOUT_MS = 10_000;
  const UPDATE_CHECK_TIMEOUT_MS = 20_000;
  const UPDATE_INSTALL_TIMEOUT_MS = 60_000;
  const POLL_IDLE_MS = 15_000;
  const POLL_RUNNING_MS = 1_500;
  const POLL_ERROR_MS = 10_000;
  const POLL_AFTER_ACTION_MS = 250;
  const TICK_MS = 30_000;
  const DEFAULT_CACHE_DAYS = 30;
  const DEFAULT_SCAN_HOURS = 6;
  const MAX_TOASTS = 4;
  const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  const FILTER_LABELS = { all: "全部", cached: "正常", failed: "失败", missing: "未采集", expired: "已过期", offline: "离线" };
  const TOAST_ICONS = { info: "#i-info", success: "#i-check", warn: "#i-warning", error: "#i-alert" };

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $("app"),
    brandMeta: $("brand-meta"),
    coverage: $("coverage"),
    coverageValue: $("coverage-value"),
    coverageTotal: $("coverage-total"),
    updater: $("updater"),
    updateStatus: $("update-status"),
    updateAction: $("update-action"),
    updateCurrent: $("update-current"),
    updateLabel: $("update-label"),
    filters: $("filters"),
    filterIndicator: $("filter-indicator"),
    search: $("search"),
    searchClear: $("search-clear"),
    refreshDue: $("refresh-due"),
    forceAll: $("force-all"),
    activity: $("activity"),
    activityText: $("activity-text"),
    activityAction: $("activity-action"),
    activityCount: $("activity-count"),
    activityBar: $("activity-bar"),
    listScroll: $("list-scroll"),
    list: $("list"),
    skeleton: $("skeleton"),
    empty: $("empty"),
    emptyIcon: $("empty-icon"),
    emptyTitle: $("empty-title"),
    emptyText: $("empty-text"),
    emptyAction: $("empty-action"),
    rowTemplate: $("row-template"),
    toastTemplate: $("toast-template"),
    toasts: $("toasts"),
    announcer: $("announcer"),
    drawer: $("drawer"),
    drawerRegion: $("drawer-region"),
    drawerTitle: $("drawer-title"),
    drawerUuid: $("drawer-uuid"),
    drawerUuidText: $("drawer-uuid-text"),
    drawerClose: $("drawer-close"),
    drawerHero: $("drawer-hero"),
    drawerHostname: $("drawer-hostname"),
    drawerCopyHost: $("drawer-copy-host"),
    drawerPill: $("drawer-pill"),
    drawerPillLabel: $("drawer-pill-label"),
    drawerPresence: $("drawer-presence"),
    drawerPresenceLabel: $("drawer-presence-label"),
    factCollected: $("fact-collected"),
    factExpiry: $("fact-expiry"),
    factAttempt: $("fact-attempt"),
    factAgent: $("fact-agent"),
    factOs: $("fact-os"),
    drawerFailure: $("drawer-failure"),
    failureReason: $("failure-reason"),
    failureStage: $("failure-stage"),
    failureTime: $("failure-time"),
    failureTask: $("failure-task"),
    failureRpcRow: $("failure-rpc-row"),
    failureRpc: $("failure-rpc"),
    failureExitRow: $("failure-exit-row"),
    failureExit: $("failure-exit"),
    failureOutput: $("failure-output"),
    drawerCopyReport: $("drawer-copy-report"),
    drawerNote: $("drawer-note"),
    drawerRefresh: $("drawer-refresh"),
    drawerRefreshLabel: $("drawer-refresh-label"),
    drawerPanel: document.querySelector("#drawer .drawer-panel"),
    confirm: $("confirm"),
    confirmIcon: $("confirm-icon"),
    confirmTitle: $("confirm-title"),
    confirmMessage: $("confirm-message"),
    confirmCancel: $("confirm-cancel"),
    confirmAccept: $("confirm-accept"),
  };
  const chips = Array.from(el.filters.querySelectorAll(".chip"));
  const countNodes = new Map(Array.from(el.filters.querySelectorAll("[data-count]"), (node) => [node.dataset.count, node]));
  const coverageSegments = Array.from(el.coverage.querySelectorAll("[data-segment]"));

  /* ---------- Small helpers ---------- */

  const motionQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reducedMotion = () => Boolean(motionQuery && motionQuery.matches);
  const canAnimate = () => !reducedMotion() && typeof Element.prototype.animate === "function";
  const requestFrame = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback) => window.setTimeout(callback, 16);
  const cancelFrame = typeof window.cancelAnimationFrame === "function"
    ? window.cancelAnimationFrame.bind(window)
    : window.clearTimeout.bind(window);

  function setText(node, value) {
    const text = String(value);
    if (node.textContent !== text) node.textContent = text;
  }

  function setTitle(node, value) {
    if (node.title !== value) node.title = value;
  }

  function setLabel(node, value) {
    if (node.getAttribute("aria-label") !== value) node.setAttribute("aria-label", value);
  }

  function setData(node, key, value) {
    if (value === null || value === undefined) {
      if (key in node.dataset) delete node.dataset[key];
    } else if (node.dataset[key] !== String(value)) {
      node.dataset[key] = String(value);
    }
  }

  function setDisabled(node, value) {
    if (node.disabled !== value) node.disabled = value;
  }

  function afterAnimation(node, callback, fallbackMs) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      node.removeEventListener("animationend", onEnd);
      callback();
    };
    const onEnd = (event) => {
      if (event.target === node) finish();
    };
    const timer = setTimeout(finish, fallbackMs);
    node.addEventListener("animationend", onEnd);
  }

  const tweens = new WeakMap();
  // Counts roll to their new value; tabular figures keep the width steady while they do.
  function tweenNumber(node, value) {
    const target = Number.isFinite(value) ? Math.round(value) : 0;
    const running = tweens.get(node);
    if (running !== undefined) {
      cancelFrame(running);
      tweens.delete(node);
    }
    const shown = Number(node.textContent);
    if (shown === target) return;
    if (!Number.isFinite(shown) || node.textContent.trim() === "" || reducedMotion() || document.hidden) {
      node.textContent = String(target);
      return;
    }
    const start = performance.now();
    const duration = Math.min(700, 360 + Math.abs(target - shown) * 4);
    const step = () => {
      const progress = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      node.textContent = String(Math.round(shown + (target - shown) * eased));
      if (progress < 1) tweens.set(node, requestFrame(step));
      else tweens.delete(node);
    };
    tweens.set(node, requestFrame(step));
  }

  /* ---------- Requests ---------- */

  let rpcId = 0;

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

  function requestError(message, details) {
    return Object.assign(new Error(message), details);
  }

  async function rpc(method, params, options = {}) {
    const response = await fetchWithDeadline("/api/rpc2", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: options.keepalive === true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }, Number(options.timeoutMs) || LOAD_TIMEOUT_MS, "请求 Komari ");
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (payload && payload.error) {
      throw requestError(payload.error.message || "RPC 请求失败", { code: payload.error.code, status: response.status });
    }
    if (!response.ok) throw requestError(`Komari 返回 HTTP ${response.status}`, { status: response.status });
    if (!payload) throw requestError("Komari 返回了无效的响应");
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
      throw requestError(response.ok ? "Komari 返回了无效的更新响应" : `HTTP ${response.status}`, { status: response.status });
    }
    if (!response.ok || payload?.status !== "success") {
      throw requestError(payload?.message || `HTTP ${response.status}`, { status: response.status });
    }
    return payload.data;
  }

  /* ---------- Toasts and announcements ---------- */

  const toastsById = new Map();
  const toastItems = new WeakMap();

  function modalOpen() {
    return el.drawer.open || el.confirm.open;
  }

  function toastLayerOpen() {
    try {
      return el.toasts.matches(":popover-open");
    } catch {
      return false;
    }
  }

  // The container is a manual popover so feedback can sit above an open dialog;
  // re-showing it moves it to the top of the top layer.
  function showToastLayer(raise) {
    if (typeof el.toasts.showPopover !== "function") return;
    try {
      if (toastLayerOpen()) {
        if (!raise) return;
        el.toasts.hidePopover();
      }
      el.toasts.showPopover();
    } catch {
      // Without a top layer the fixed container is still visible outside dialogs.
    }
  }

  function hideToastLayerIfEmpty() {
    if (el.toasts.childElementCount > 0 || !toastLayerOpen()) return;
    try {
      el.toasts.hidePopover();
    } catch {
      // Already hidden.
    }
  }

  function removeToast(item) {
    clearTimeout(item.timer);
    if (item.id && toastsById.get(item.id) === item) toastsById.delete(item.id);
    item.node.remove();
    hideToastLayerIfEmpty();
  }

  function dismissToast(item) {
    if (!item || item.leaving || !item.node.isConnected) return;
    item.leaving = true;
    clearTimeout(item.timer);
    if (item.id && toastsById.get(item.id) === item) toastsById.delete(item.id);
    if (reducedMotion()) {
      removeToast(item);
      return;
    }
    item.node.classList.remove("is-entering");
    item.node.classList.add("is-leaving");
    afterAnimation(item.node, () => removeToast(item), 260);
  }

  function dismissToastById(id) {
    dismissToast(toastsById.get(id));
  }

  function toast(message, options = {}) {
    const tone = options.tone || "info";
    const id = options.id || null;
    let item = id ? toastsById.get(id) : null;
    if (!item || item.leaving || !item.node.isConnected) {
      const node = el.toastTemplate.content.firstElementChild.cloneNode(true);
      item = { id, node, text: node.querySelector(".toast-text"), icon: node.querySelector("use"), timer: null, leaving: false };
      toastItems.set(node, item);
      node.querySelector(".toast-close").addEventListener("click", () => dismissToast(item));
      if (!reducedMotion()) {
        node.classList.add("is-entering");
        afterAnimation(node, () => node.classList.remove("is-entering"), 400);
      }
      el.toasts.append(node);
      if (id) toastsById.set(id, item);
      while (el.toasts.childElementCount > MAX_TOASTS) {
        const oldest = toastItems.get(el.toasts.firstElementChild);
        if (!oldest) break;
        removeToast(oldest);
      }
    }
    item.node.dataset.tone = tone;
    item.node.setAttribute("role", tone === "error" ? "alert" : "status");
    item.icon.setAttribute("href", TOAST_ICONS[tone] || TOAST_ICONS.info);
    setText(item.text, message);
    clearTimeout(item.timer);
    const life = options.duration ?? (tone === "error" ? 0 : 3600);
    if (life > 0) item.timer = setTimeout(() => dismissToast(item), life);
    showToastLayer(modalOpen());
    return item;
  }

  let announceTimer = null;
  function announce(message) {
    clearTimeout(announceTimer);
    el.announcer.textContent = "";
    announceTimer = setTimeout(() => {
      el.announcer.textContent = message;
    }, 80);
  }

  async function copyText(text) {
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall back to a selection copy below.
    }
    // Inside a modal dialog everything else is inert, so the buffer must live in it.
    const host = el.drawer.open ? el.drawer : el.confirm.open ? el.confirm : document.body;
    const buffer = document.createElement("textarea");
    buffer.className = "copy-buffer";
    buffer.value = text;
    buffer.setAttribute("readonly", "");
    host.append(buffer);
    buffer.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    buffer.remove();
    return copied;
  }

  const copyFeedback = new WeakMap();
  function showCopied(button, labelNode) {
    const use = button.querySelector("use");
    const previous = copyFeedback.get(button);
    if (previous) clearTimeout(previous.timer);
    const original = previous ? previous.original : { href: use?.getAttribute("href") || "", label: labelNode?.textContent || "" };
    if (use) use.setAttribute("href", "#i-check");
    if (labelNode) labelNode.textContent = "已复制";
    button.classList.add("copy-done");
    const timer = setTimeout(() => {
      if (use) use.setAttribute("href", original.href);
      if (labelNode) labelNode.textContent = original.label;
      button.classList.remove("copy-done");
      copyFeedback.delete(button);
    }, 1600);
    copyFeedback.set(button, { timer, original });
  }

  /* ---------- Confirmation dialog ---------- */

  let pendingConfirmation = null;

  function settleConfirmation(approved) {
    const pending = pendingConfirmation;
    if (!pending || pending.settling) return;
    pending.settling = true;
    const finish = () => {
      if (pendingConfirmation !== pending) return;
      pendingConfirmation = null;
      el.confirm.classList.remove("is-closing");
      if (el.confirm.open) {
        if (typeof el.confirm.close === "function") el.confirm.close();
        else el.confirm.removeAttribute("open");
      }
      pending.resolve(approved);
    };
    if (el.confirm.open && !reducedMotion()) {
      el.confirm.classList.add("is-closing");
      afterAnimation(el.confirm, finish, 220);
    } else {
      finish();
    }
  }

  function requestConfirmation({ title, message, confirmLabel = "继续", icon = "#i-zap" }) {
    if (pendingConfirmation) return Promise.resolve(false);
    setText(el.confirmTitle, title);
    setText(el.confirmMessage, message);
    setText(el.confirmAccept, confirmLabel);
    el.confirmIcon.setAttribute("href", icon);
    return new Promise((resolve) => {
      const pending = { resolve, settling: false };
      pendingConfirmation = pending;
      try {
        el.confirm.classList.remove("is-closing");
        if (typeof el.confirm.showModal === "function") el.confirm.showModal();
        else el.confirm.setAttribute("open", "");
        el.confirmCancel.focus();
      } catch {
        if (pendingConfirmation === pending) pendingConfirmation = null;
        toast("无法打开确认窗口，请刷新页面后重试", { tone: "error" });
        resolve(false);
      }
    });
  }

  /* ---------- Self update ---------- */

  const updater = { mode: "idle", message: "", available: null, busy: false, current: CURRENT_VERSION };
  const UPDATER_LABELS = {
    idle: "检查更新",
    checking: "检查中",
    current: "已是最新",
    ahead: "检查更新",
    installing: "正在更新",
    installed: "正在重载",
    error: "重试",
  };

  function renderUpdater() {
    setData(el.updater, "mode", updater.mode);
    setText(el.updateCurrent, `v${updater.current}`);
    const label = updater.mode === "available" && updater.available
      ? `更新到 v${updater.available.version}`
      : UPDATER_LABELS[updater.mode] || "检查更新";
    setText(el.updateLabel, label);
    setText(el.updateStatus, updater.message);
    const busy = updater.busy || updater.mode === "checking" || updater.mode === "installing" || updater.mode === "installed";
    setDisabled(el.updateAction, busy);
    let title = updater.message || "检查 GitHub Release 上的新版本（只在点击时访问）";
    if (updater.mode === "available" && updater.available) title = `发现新版本 v${updater.available.version}，点击安装`;
    else if (updater.mode === "current" || updater.mode === "ahead") title = `${updater.message}，点击再次检查`;
    setTitle(el.updateAction, title);
    setLabel(el.updateAction, `${label}（当前版本 v${updater.current}）`);
  }

  function setUpdater(mode, message, available = null) {
    updater.mode = mode;
    updater.message = message;
    updater.available = available;
    renderUpdater();
  }

  // The status text is hidden on narrow screens; mirror results as a toast there.
  function updaterStatusHidden() {
    return el.updateStatus.offsetParent === null;
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
    const source = sourceWithURL(await listUpdateSources());
    if (source && source.enabled === true) return source;

    if (source) {
      const approved = await requestConfirmation({
        title: "重新启用更新源",
        message: "Onani 更新源已被停用。重新启用后才可继续检查 GitHub Release。",
        confirmLabel: "启用并检查",
        icon: "#i-up",
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
    if (updater.busy) return;
    updater.busy = true;
    dismissToastById("update-error");
    setUpdater("checking", "正在读取自有更新源");
    try {
      const source = await ensureUpdateSource();
      if (!source) {
        setUpdater("idle", "已取消检查，未更改更新源");
        return;
      }
      if (typeof source.id !== "string" || !source.id) throw new Error("更新源缺少有效 ID");

      const [catalog, installedPlugins] = await Promise.all([
        adminRequest(`${PLUGIN_MARKET_API}/catalog?refresh=true`, { label: "检查 GitHub Release" }),
        rpc("admin:listPlugins", undefined, { timeoutMs: ACTION_TIMEOUT_MS }),
      ]);
      const catalogData = Model.recordOrEmpty(catalog);
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

      updater.current = installedVersion(installedPlugins);
      const comparison = Model.compareSemver(latest.version, updater.current);
      if (comparison === null) throw new Error("更新源返回了无法识别的版本号");
      if (comparison > 0) {
        setUpdater("available", `发现新版本 v${latest.version}`, { sourceId: source.id, version: latest.version });
        if (updaterStatusHidden()) toast(`发现新版本 v${latest.version}，点击右上角按钮安装`, { tone: "info", id: "update-result" });
      } else if (comparison === 0) {
        setUpdater("current", "已是最新正式版本");
        if (updaterStatusHidden()) toast("已是最新正式版本", { tone: "success", id: "update-result" });
      } else {
        setUpdater("ahead", `当前版本高于更新源 v${latest.version}`);
        if (updaterStatusHidden()) toast(`当前版本高于更新源 v${latest.version}`, { tone: "info", id: "update-result" });
      }
    } catch (error) {
      setUpdater("error", "检查更新失败");
      toast(error instanceof Error ? error.message : "检查更新失败", { tone: "error", id: "update-error" });
    } finally {
      updater.busy = false;
      renderUpdater();
    }
  }

  async function refreshUpdatedAssets() {
    await Promise.allSettled(PAGE_ASSETS.map(async (asset) => {
      const response = await fetchWithDeadline(new URL(asset, window.location.href), {
        method: "GET",
        credentials: "same-origin",
        cache: "reload",
      }, 8_000, "刷新页面资源");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }));
  }

  async function installAvailableUpdate() {
    if (updater.busy || !updater.available) return;
    const target = updater.available;
    const approved = await requestConfirmation({
      title: `更新到 v${target.version}`,
      message: `Komari 将从 GitHub Release 下载并校验 Onani v${target.version}（当前 v${updater.current}）。插件配置和主机名缓存会保留；若新版权限有变化，需要在插件管理中重新批准。`,
      confirmLabel: "开始更新",
      icon: "#i-up",
    });
    if (!approved) return;

    updater.busy = true;
    dismissToastById("update-error");
    clearTimeout(pollTimer);
    setUpdater("installing", "Komari 正在下载、校验并安装", target);
    let reloading = false;
    try {
      const installed = Model.recordOrEmpty(await adminRequest(`${PLUGIN_MARKET_API}/install`, {
        method: "POST",
        body: { source_id: target.sourceId, short: PLUGIN_SHORT },
        timeoutMs: UPDATE_INSTALL_TIMEOUT_MS,
        label: "安装更新",
        keepalive: true,
      }));
      if (String(installed.short || "").toLowerCase() !== PLUGIN_SHORT || typeof installed.version !== "string") {
        throw new Error("Komari 安装结果与 Onani 不匹配");
      }
      const installedComparison = Model.compareSemver(installed.version, target.version);
      if (installedComparison === null || installedComparison < 0) {
        throw new Error("Komari 安装结果低于确认的目标版本");
      }

      updater.current = installed.version;
      setUpdater("installed", `已安装 v${installed.version}，正在重新载入`);
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
        ? "新版已写入，但权限声明发生变化；请到插件管理重新启用 Onani 并批准权限。"
        : rawMessage;
      setUpdater("error", "更新未完成");
      toast(message, { tone: "error", id: "update-error" });
    } finally {
      if (!reloading) {
        updater.busy = false;
        renderUpdater();
        schedule(3_000);
      }
    }
  }

  function consumeUpdateReloadMarker() {
    try {
      const updatedVersion = window.sessionStorage?.getItem(UPDATE_RELOAD_MARKER);
      window.sessionStorage?.removeItem(UPDATE_RELOAD_MARKER);
      if (updatedVersion === CURRENT_VERSION) {
        setUpdater("current", `已更新到 v${CURRENT_VERSION}`);
        toast(`已成功更新到 v${CURRENT_VERSION}`, { tone: "success" });
      }
    } catch {
      // A blocked session store only suppresses the one-time success message.
    }
  }

  async function handleUpdateAction() {
    if (updater.mode === "available" && updater.available) await installAvailableUpdate();
    else await checkForUpdates();
  }

  /* ---------- View state ---------- */

  const view = {
    data: { nodes: {}, statuses: {}, plugin: {} },
    loaded: false,
    error: null,
    filter: "all",
    query: "",
    rows: [],
    byKey: new Map(),
    visible: [],
    counts: Model.summarize([]),
    cacheDays: DEFAULT_CACHE_DAYS,
    selected: null,
  };
  const pending = { keys: new Set(), bulk: false, bulkSource: null };
  let loading = false;
  let pollTimer = null;
  // Bumped whenever a local action changes the refresh snapshot, so a poll that was
  // already in flight cannot overwrite it with older server state.
  let localRevision = 0;

  function pluginStatus() {
    return Model.recordOrEmpty(view.data.plugin);
  }

  function config() {
    return Model.recordOrEmpty(pluginStatus().config);
  }

  function refreshState() {
    return Model.recordOrEmpty(pluginStatus().refresh);
  }

  function featureEnabled() {
    return config().enabled !== false;
  }

  function rebuild() {
    const days = Number(config().cache_days);
    view.cacheDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_CACHE_DAYS;
    view.rows = Model.buildRows(view.data.nodes, view.data.statuses, pluginStatus().entries, view.cacheDays, Date.now());
    view.byKey = new Map(view.rows.map((row) => [row.key, row]));
    view.counts = Model.summarize(view.rows);
  }

  function taskOf(row) {
    return Model.taskStateOf(row.key, refreshState(), pending.keys);
  }

  function refreshBlockReason(row, task) {
    if (task === "active") return "正在刷新这个节点";
    if (task === "queued") return "这个节点正在排队等待刷新";
    if (!featureEnabled()) return "主机名采集已在插件设置中关闭";
    if (!row.online) return "节点离线，无法刷新主机名";
    return null;
  }

  /* ---------- Header, filters, actions ---------- */

  function renderHeader() {
    const parts = ["Onani 工具箱"];
    if (view.loaded) {
      const cfg = config();
      if (!featureEnabled()) {
        parts.push("主机名采集已关闭");
      } else {
        parts.push(`缓存 ${view.cacheDays} 天`);
        const hours = Number(cfg.scan_interval_hours) > 0 ? Number(cfg.scan_interval_hours) : DEFAULT_SCAN_HOURS;
        parts.push(cfg.auto_refresh === false ? "自动刷新已关闭" : `每 ${hours} 小时自动检查`);
      }
    }
    setText(el.brandMeta, parts.join(" · "));

    const total = view.counts.all;
    setData(el.coverage, "visible", view.loaded && total > 0 ? "true" : "false");
    const withHostname = view.rows.reduce((sum, row) => sum + (row.hostname ? 1 : 0), 0);
    tweenNumber(el.coverageValue, withHostname);
    setText(el.coverageTotal, ` / ${total}`);
    const counts = view.counts;
    setTitle(el.coverage, `已获取主机名 ${withHostname} / ${total}：正常 ${counts.cached}、已过期 ${counts.expired}、失败 ${counts.failed}、未采集 ${counts.missing}`);
    for (const segment of coverageSegments) {
      const share = total > 0 ? (counts[segment.dataset.segment] || 0) / total : 0;
      const width = `${(share * 100).toFixed(3)}%`;
      if (segment.style.width !== width) segment.style.width = width;
    }
  }

  let indicatorReady = false;

  function placeIndicator(instant = false) {
    const chip = chips.find((item) => item.dataset.filter === view.filter) || chips[0];
    if (!chip || chip.offsetWidth === 0) return;
    const jump = instant || !indicatorReady || reducedMotion();
    el.filterIndicator.classList.toggle("is-instant", jump);
    el.filterIndicator.style.width = `${chip.offsetWidth}px`;
    el.filterIndicator.style.transform = `translateX(${chip.offsetLeft}px)`;
    if (jump) {
      void el.filterIndicator.offsetWidth;
      el.filterIndicator.classList.remove("is-instant");
    }
    indicatorReady = true;
  }

  function updateFilterFade() {
    const container = el.filters;
    const max = container.scrollWidth - container.clientWidth;
    const start = max > 1 && container.scrollLeft > 1;
    const end = max > 1 && container.scrollLeft < max - 1;
    setData(container, "fade", start && end ? "both" : start ? "start" : end ? "end" : "none");
  }

  // Keep the selected chip visible in the horizontally scrolling strip without
  // scrollIntoView, which would also scroll the admin page around the iframe.
  function revealChip(chip) {
    const container = el.filters;
    if (container.scrollWidth <= container.clientWidth) return;
    const left = chip.offsetLeft - 12;
    const right = chip.offsetLeft + chip.offsetWidth + 12 - container.clientWidth;
    let target = container.scrollLeft;
    if (left < container.scrollLeft) target = left;
    else if (right > container.scrollLeft) target = right;
    if (target === container.scrollLeft) return;
    if (typeof container.scrollTo === "function") container.scrollTo({ left: target, behavior: reducedMotion() ? "auto" : "smooth" });
    else container.scrollLeft = target;
  }

  function renderFilters() {
    for (const [key, node] of countNodes) tweenNumber(node, view.counts[key] || 0);
    // Nothing to filter until the first successful load.
    setDisabled(el.search, !view.loaded);
    for (const chip of chips) {
      const key = chip.dataset.filter;
      const selected = key === view.filter;
      setDisabled(chip, !view.loaded);
      chip.setAttribute("aria-checked", String(selected));
      chip.tabIndex = selected ? 0 : -1;
      setData(chip, "empty", key !== "all" && (view.counts[key] || 0) === 0 ? "true" : "false");
    }
    placeIndicator();
  }

  function renderActions() {
    const refresh = refreshState();
    const bulk = refresh.bulk_running === true || pending.bulk;
    let reason = null;
    if (!view.loaded) reason = "正在读取节点";
    else if (!featureEnabled()) reason = "主机名采集已在插件设置中关闭";
    else if (view.counts.online === 0) reason = "当前没有在线节点";
    else if (bulk) reason = "批量刷新正在进行";
    setDisabled(el.refreshDue, reason !== null);
    setDisabled(el.forceAll, reason !== null);
    setTitle(el.refreshDue, reason || "刷新缺失或已过期的在线节点（不会重复请求失败退避中的节点）");
    setTitle(el.forceAll, reason || "强制刷新全部在线节点");
    setData(el.refreshDue, "busy", pending.bulk && pending.bulkSource === "due" ? "true" : null);
    setData(el.forceAll, "busy", pending.bulk && pending.bulkSource === "force" ? "true" : null);
  }

  let progressRunning = false;

  // A new run starts from empty without sliding back from the previous 100%;
  // a finished run fills the bar while it fades out.
  function paintProgress(running, ratio) {
    const bar = el.activityBar;
    const scale = (value) => `scaleX(${Math.max(0, Math.min(1, value)).toFixed(4)})`;
    if (running && !progressRunning) {
      bar.classList.add("is-instant");
      bar.style.transform = scale(ratio ?? 0);
      void bar.offsetWidth;
      bar.classList.remove("is-instant");
    } else if (running) {
      const next = scale(ratio ?? 0);
      if (bar.style.transform !== next) bar.style.transform = next;
    } else if (progressRunning) {
      bar.style.transform = scale(1);
    }
    progressRunning = running;
  }

  function renderActivity() {
    const now = Date.now();
    const refresh = refreshState();
    const progress = Model.progressOf(refresh);
    const last = Model.lastRefresh(refresh);
    let state = "idle";
    let text = "刷新任务在 Komari 后台执行，关闭页面也不会中断";
    let showFailures = false;

    if (!view.loaded && !view.error) {
      state = "loading";
      text = "正在读取节点与缓存…";
    } else if (!view.loaded) {
      state = "warning";
      text = view.error.kind === "not-running"
        ? "插件未运行，启用后会自动恢复"
        : view.error.kind === "auth"
          ? "登录状态已失效"
          : `读取失败，${POLL_ERROR_MS / 1000} 秒后自动重试`;
    } else if (!featureEnabled()) {
      state = "warning";
      text = "主机名采集已在插件设置中关闭，自动和手动刷新均已暂停";
    } else if (progress.running || pending.bulk) {
      state = "running";
      // Until Komari confirms the run, refresh.message still describes the previous one.
      text = progress.running && progress.message ? progress.message : "正在提交刷新任务…";
      if (progress.running && progress.total > 0) text += `（${progress.done}/${progress.total}）`;
    } else if (last) {
      state = last.failed > 0 ? "warning" : "done";
      if (last.targeted === 0 && last.message) {
        text = `${last.message} · ${Model.formatRelative(last.finishedAt, now)}`;
      } else {
        text = `上次刷新 ${Model.formatCompact(last.finishedAt, now)} · 成功 ${last.succeeded}${last.failed > 0 ? ` · 失败 ${last.failed}` : ""}`;
      }
      showFailures = last.failed > 0 && view.counts.failed > 0 && view.filter !== "failed";
    }

    setData(el.activity, "state", state);
    // Until the first node reports back a 0% bar would look idle, so keep it moving.
    const indeterminate = state === "running" && (progress.ratio === null || progress.done === 0);
    setData(el.activity, "indeterminate", indeterminate ? "true" : "false");
    setText(el.activityText, text);
    setTitle(el.activityText, text);
    el.activityAction.hidden = !showFailures;
    paintProgress(state === "running", progress.ratio);

    const total = view.rows.length;
    const visible = view.visible.length;
    setText(el.activityCount, !view.loaded ? "" : visible === total ? `${total} 个节点` : `${visible} / ${total}`);
  }

  /* ---------- List ---------- */

  const rowItems = new Map();

  function createRowItem(key) {
    const li = el.rowTemplate.content.firstElementChild.cloneNode(true);
    li.dataset.key = key;
    return {
      li,
      signature: "",
      timeText: null,
      region: li.querySelector(".region"),
      name: li.querySelector(".row-name"),
      id: li.querySelector(".row-id"),
      hostname: li.querySelector(".hostname"),
      hostnameText: li.querySelector(".hostname-text"),
      pill: li.querySelector(".pill"),
      pillLabel: li.querySelector(".pill-label"),
      presence: li.querySelector(".presence"),
      presenceLabel: li.querySelector(".presence-label"),
      time: li.querySelector(".time"),
      refresh: li.querySelector(".row-refresh"),
      error: li.querySelector(".row-error"),
      errorText: li.querySelector(".row-error-text"),
    };
  }

  function paintRow(item, row) {
    setData(item.li, "state", row.state);
    setData(item.li, "hasHost", row.hostname ? "true" : "false");
    setData(item.li, "hasError", row.error ? "true" : "false");
    setText(item.region, row.region);
    setTitle(item.region, row.region ? `地区 ${row.region}` : "");
    setText(item.name, row.name);
    setTitle(item.name, `${row.name}（查看详情）`);
    setText(item.id, Model.shortUuid(row.uuid));
    setTitle(item.id, row.uuid);
    setText(item.hostnameText, row.hostname);
    setTitle(item.hostname, row.hostname ? `点击复制：${row.hostname}` : "");
    setLabel(item.hostname, `复制主机名 ${row.hostname}`);
    setData(item.presence, "online", row.online ? "true" : "false");
    setText(item.presenceLabel, row.online ? "在线" : "离线");
    setText(item.errorText, row.error);
    setTitle(item.error, row.error);
    setLabel(item.error, `查看失败详情：${row.error}`);
  }

  function paintTask(item, row, task) {
    setData(item.li, "task", task);
    setData(item.pill, "tone", task === "active" ? "busy" : task === "queued" ? "queued" : row.state);
    setText(item.pillLabel, task === "active" ? "刷新中" : task === "queued" ? "排队中" : Model.stateLabel(row));
    const blocked = refreshBlockReason(row, task);
    setDisabled(item.refresh, blocked !== null);
    setTitle(item.refresh, blocked || "强制刷新这个节点");
    setLabel(item.refresh, blocked ? `${row.name}：${blocked}` : `强制刷新 ${row.name}`);
  }

  function paintTime(item, row, now) {
    const text = row.collectedAt === null ? "—" : Model.formatRelative(row.collectedAt, now);
    if (item.timeText !== text) {
      item.timeText = text;
      setText(item.time, text);
    }
    const lines = [row.collectedAt === null ? "尚未采集" : `采集于 ${Model.formatAbsolute(row.collectedAt)}`];
    if (row.attemptAt !== null) lines.push(`最近尝试 ${Model.formatAbsolute(row.attemptAt)}`);
    setTitle(item.time, lines.join("\n"));
    const iso = row.collectedAt === null ? null : new Date(row.collectedAt).toISOString();
    if (iso === null) item.time.removeAttribute("datetime");
    else if (item.time.getAttribute("datetime") !== iso) item.time.setAttribute("datetime", iso);
  }

  function flash(node) {
    if (reducedMotion()) return;
    node.classList.remove("is-flashing");
    void node.offsetWidth;
    node.classList.add("is-flashing");
  }

  function syncRow(row, now) {
    let item = rowItems.get(row.key);
    if (!item) {
      item = createRowItem(row.key);
      rowItems.set(row.key, item);
    }
    const signature = Model.rowSignature(row);
    if (item.signature !== signature) {
      // Only rows that were on screen flash; rows revealed by a filter just appear.
      const changedInPlace = item.signature !== "" && item.li.isConnected;
      paintRow(item, row);
      item.signature = signature;
      if (changedInPlace) flash(item.li);
    }
    paintTime(item, row, now);
    paintTask(item, row, taskOf(row));
    if (view.selected === row.key) item.li.setAttribute("aria-current", "true");
    else item.li.removeAttribute("aria-current");
    return item;
  }

  function measureRows() {
    if (!canAnimate()) return null;
    const bounds = el.listScroll.getBoundingClientRect();
    const positions = new Map();
    for (const node of el.list.children) {
      const rect = node.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
      positions.set(node, rect.top);
    }
    return positions;
  }

  // FLIP: rows that stay slide from where they were, newly shown rows fade up.
  function playRowMotion(before, nodes) {
    if (!before) return;
    for (const node of nodes) {
      for (const animation of node.getAnimations ? node.getAnimations() : []) {
        if (animation.id === "row-motion") animation.cancel();
      }
    }
    const bounds = el.listScroll.getBoundingClientRect();
    let entering = 0;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.top > bounds.bottom) break;
      if (rect.bottom < bounds.top) continue;
      const previous = before.get(node);
      let animation = null;
      if (previous === undefined) {
        animation = node.animate(
          [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
          { duration: 260, easing: EASE_OUT, delay: Math.min(entering * 22, 220), fill: "backwards" },
        );
        entering += 1;
      } else if (Math.abs(previous - rect.top) >= 1) {
        animation = node.animate(
          [{ transform: `translateY(${previous - rect.top}px)` }, { transform: "none" }],
          { duration: 300, easing: EASE_OUT },
        );
      }
      if (animation) animation.id = "row-motion";
    }
  }

  function filterDescription() {
    const label = FILTER_LABELS[view.filter] || "全部";
    const query = view.query.trim();
    if (query && view.filter !== "all") return `「${label}」中没有匹配“${query}”的节点，可以换个关键词或清除筛选。`;
    if (query) return `没有节点的名称、主机名或 UUID 包含“${query}”。`;
    return `当前没有「${label}」状态的节点。`;
  }

  let emptyHandler = null;

  function errorEmptyState(error) {
    if (error.kind === "not-running") {
      return {
        icon: "#i-plug",
        title: "插件未运行",
        text: `${error.message}请在 Komari「插件管理」中启用 Onani 并批准权限，然后重试。`,
        action: "重试",
        handler: retryLoad,
      };
    }
    if (error.kind === "auth") {
      return { icon: "#i-alert", title: "需要重新登录", text: error.message, action: "刷新页面", handler: () => window.location.reload() };
    }
    return { icon: "#i-cloud-off", title: "暂时无法读取数据", text: error.message, action: "重试", handler: retryLoad };
  }

  function renderListState() {
    const firstLoad = !view.loaded && !view.error;
    el.skeleton.hidden = !firstLoad;
    let empty = null;
    if (!view.loaded && view.error) {
      empty = errorEmptyState(view.error);
    } else if (view.loaded && view.rows.length === 0) {
      empty = { icon: "#i-server", title: "暂无节点", text: "Komari 中还没有可以显示的节点。" };
    } else if (view.loaded && view.visible.length === 0) {
      empty = { icon: "#i-search-x", title: "没有匹配的节点", text: filterDescription(), action: "清除筛选", handler: () => clearFilters(true) };
    }
    el.list.hidden = !view.loaded || view.visible.length === 0;
    setData(el.listScroll, "state", empty ? "empty" : firstLoad ? "loading" : "ready");
    emptyHandler = empty?.handler || null;
    if (!empty) {
      el.empty.hidden = true;
      return;
    }
    el.emptyIcon.setAttribute("href", empty.icon);
    setText(el.emptyTitle, empty.title);
    setText(el.emptyText, empty.text || "");
    el.emptyText.hidden = !empty.text;
    el.emptyAction.hidden = !empty.action;
    if (empty.action) setText(el.emptyAction, empty.action);
    setDisabled(el.emptyAction, loading);
    el.empty.hidden = false;
  }

  function renderList(options = {}) {
    view.visible = Model.filterRows(view.rows, view.filter, view.query);
    const before = options.enter ? (canAnimate() ? new Map() : null) : options.motion ? measureRows() : null;
    const now = Date.now();
    const nodes = view.visible.map((row) => syncRow(row, now).li);
    const keep = new Set(nodes);
    for (const child of Array.from(el.list.children)) {
      if (!keep.has(child)) child.remove();
    }
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (el.list.children[index] !== node) el.list.insertBefore(node, el.list.children[index] || null);
    }
    for (const key of rowItems.keys()) {
      if (!view.byKey.has(key)) rowItems.delete(key);
    }
    if (options.motion) el.listScroll.scrollTop = 0;
    renderListState();
    playRowMotion(before, nodes);
  }

  function renderAll(options = {}) {
    setData(el.app, "view", view.loaded ? "ready" : view.error ? "error" : "loading");
    renderHeader();
    renderFilters();
    renderActions();
    renderList(options);
    renderActivity();
    renderDrawer();
  }

  let filterFrame = null;
  function scheduleFilterRender() {
    if (filterFrame !== null) return;
    filterFrame = requestFrame(() => {
      filterFrame = null;
      renderList({ motion: true });
      renderActivity();
    });
  }

  function setFilter(filter) {
    const next = Model.normalizeFilter(filter);
    if (next === view.filter) return;
    view.filter = next;
    renderFilters();
    renderList({ motion: true });
    renderActivity();
    const chip = chips.find((item) => item.dataset.filter === next);
    if (chip) revealChip(chip);
    announce(`${FILTER_LABELS[next]}：${view.visible.length} 个节点`);
  }

  function clearFilters(focusSearch) {
    el.search.value = "";
    view.query = "";
    syncSearchControls();
    if (view.filter !== "all") {
      view.filter = "all";
      renderFilters();
    }
    renderList({ motion: true });
    renderActivity();
    if (focusSearch) el.search.focus();
  }

  function syncSearchControls() {
    const filled = el.search.value.length > 0;
    el.searchClear.hidden = !filled;
    setData(el.search.parentElement, "filled", filled ? "true" : "false");
  }

  /* ---------- Drawer ---------- */

  let drawerOpener = null;
  let drawerKey = null;

  function factValue(node, main, sub) {
    const signature = `${main}\u0000${sub || ""}`;
    if (node.dataset.value === signature) return;
    node.dataset.value = signature;
    const parts = [document.createTextNode(main)];
    if (sub) {
      const small = document.createElement("span");
      small.className = "fact-sub";
      small.textContent = sub;
      parts.push(small);
    }
    node.replaceChildren(...parts);
  }

  function renderDrawer() {
    if (view.selected === null) return;
    const row = view.byKey.get(view.selected);
    if (!row) {
      if (view.loaded && el.drawer.open) {
        closeDrawer();
        toast("该节点已从 Komari 中删除", { tone: "warn" });
      }
      if (view.loaded) view.selected = null;
      return;
    }
    const now = Date.now();
    const task = taskOf(row);
    setText(el.drawerRegion, row.region);
    setText(el.drawerTitle, row.name);
    setTitle(el.drawerTitle, row.name);
    setText(el.drawerUuidText, row.uuid);
    setData(el.drawerHero, "empty", row.hostname ? "false" : "true");
    setText(el.drawerHostname, row.hostname || "尚未获取主机名");
    setData(el.drawerPill, "tone", task === "active" ? "busy" : task === "queued" ? "queued" : row.state);
    setText(el.drawerPillLabel, task === "active" ? "刷新中" : task === "queued" ? "排队中" : Model.stateLabel(row));
    setData(el.drawerPresence, "online", row.online ? "true" : "false");
    setText(el.drawerPresenceLabel, row.online ? "在线" : "离线");

    factValue(el.factCollected, row.collectedAt === null ? "尚未采集" : Model.formatAbsolute(row.collectedAt), row.collectedAt === null ? "" : Model.formatRelative(row.collectedAt, now));
    const expiry = Model.expiryOf(row, view.cacheDays);
    factValue(el.factExpiry, expiry === null ? "—" : Model.formatAbsolute(expiry), expiry === null ? "" : expiry <= now ? "已过期，下次扫描时刷新" : Model.formatRelative(expiry, now));
    factValue(el.factAttempt, row.attemptAt === null ? "—" : Model.formatAbsolute(row.attemptAt), row.attemptAt === null ? "" : Model.formatRelative(row.attemptAt, now));
    factValue(el.factAgent, row.version || "未知", "");
    factValue(el.factOs, row.os || "未知", "");

    el.drawerFailure.hidden = !row.error;
    if (row.error) {
      const failure = row.failure;
      setText(el.failureReason, row.error);
      setText(el.failureStage, failure?.stage || "旧记录未保存阶段");
      setText(el.failureTime, Model.formatAbsolute(failure?.at ?? row.attemptAt));
      setText(el.failureTask, failure?.taskId || "尚未下发任务");
      el.failureRpcRow.hidden = failure?.rpcCode === null || failure?.rpcCode === undefined;
      setText(el.failureRpc, failure?.rpcCode ?? "");
      el.failureExitRow.hidden = failure?.exitCode === null || failure?.exitCode === undefined;
      setText(el.failureExit, failure?.exitCode ?? "");
      el.failureOutput.hidden = !failure?.output;
      setText(el.failureOutput, failure?.output || "");
    }

    const blocked = refreshBlockReason(row, task);
    setDisabled(el.drawerRefresh, blocked !== null);
    setData(el.drawerRefresh, "busy", task === "active" ? "true" : null);
    setText(el.drawerRefreshLabel, task === "active" ? "刷新中" : task === "queued" ? "排队中" : "强制刷新");
    setText(el.drawerNote, blocked || "执行固定命令 hostname，系统没有该命令时改用 uname -n。");
  }

  function markSelected() {
    for (const [key, item] of rowItems) {
      if (key === view.selected) item.li.setAttribute("aria-current", "true");
      else item.li.removeAttribute("aria-current");
    }
  }

  function openDrawer(key, opener) {
    if (!view.byKey.has(key)) return;
    view.selected = key;
    drawerKey = key;
    drawerOpener = opener instanceof HTMLElement ? opener : null;
    renderDrawer();
    markSelected();
    if (!el.drawer.open) {
      el.drawer.classList.remove("is-closing");
      try {
        if (typeof el.drawer.showModal === "function") el.drawer.showModal();
        else el.drawer.setAttribute("open", "");
      } catch {
        el.drawer.setAttribute("open", "");
      }
    }
    el.drawer.querySelector(".drawer-body").scrollTop = 0;
    // Focus the panel rather than a button so a mouse user sees no stray focus ring;
    // keyboard users continue with Tab from the top of the drawer.
    el.drawerPanel.focus({ preventScroll: true });
  }

  function closeDrawer() {
    if (!el.drawer.open || el.drawer.classList.contains("is-closing")) return;
    const finish = () => {
      el.drawer.classList.remove("is-closing");
      if (!el.drawer.open) return;
      // The close event is dispatched in a later task; drop the row highlight right away.
      clearSelection();
      if (typeof el.drawer.close === "function") el.drawer.close();
      else {
        el.drawer.removeAttribute("open");
        onDrawerClosed();
      }
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    el.drawer.classList.add("is-closing");
    afterAnimation(el.drawer, finish, 280);
  }

  function clearSelection() {
    if (view.selected === null) return;
    view.selected = null;
    markSelected();
  }

  // Also runs when the browser closes the dialog on its own, so it must be idempotent.
  function onDrawerClosed() {
    clearSelection();
    const fallback = drawerKey ? rowItems.get(drawerKey)?.name : null;
    const target = drawerOpener && drawerOpener.isConnected ? drawerOpener : fallback && fallback.isConnected ? fallback : null;
    drawerOpener = null;
    drawerKey = null;
    el.drawer.classList.remove("is-closing");
    if (target) target.focus({ preventScroll: true });
  }

  /* ---------- Loading ---------- */

  function schedule(delay) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void load(), delay);
  }

  function announceRefreshResult() {
    const refresh = refreshState();
    const last = Model.lastRefresh(refresh);
    if (!last) return;
    const message = last.targeted === 0 && last.message
      ? last.message
      : `刷新完成：成功 ${last.succeeded}${last.failed > 0 ? `，失败 ${last.failed}` : ""}`;
    announce(message);
    if (refresh.reason === "manual") toast(message, { tone: last.failed > 0 ? "warn" : "success", id: "refresh-result" });
  }

  async function load() {
    if (loading || document.hidden || updater.mode === "installing" || updater.mode === "installed") return;
    loading = true;
    setDisabled(el.emptyAction, true);
    const wasRunning = Model.progressOf(refreshState()).running;
    const revision = localRevision;
    try {
      const [nodes, statuses, plugin] = await Promise.all([
        rpc("common:getNodes"),
        rpc("common:getNodesLatestStatus"),
        rpc(STATUS_RPC),
      ]);
      if (revision !== localRevision) {
        loading = false;
        schedule(POLL_AFTER_ACTION_MS);
        return;
      }
      const firstLoad = !view.loaded;
      view.data = {
        nodes: Model.recordOrEmpty(nodes),
        statuses: Model.recordOrEmpty(statuses),
        plugin: Model.recordOrEmpty(plugin),
      };
      view.loaded = true;
      view.error = null;
      dismissToastById("load-error");
      rebuild();
      loading = false;
      renderAll({ enter: firstLoad });
      const running = Model.progressOf(refreshState()).running;
      if (wasRunning && !running) announceRefreshResult();
      schedule(running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    } catch (error) {
      view.error = Model.describeError(error, "读取插件状态失败");
      if (view.loaded) toast(view.error.message, { tone: "error", id: "load-error" });
      loading = false;
      renderAll();
      schedule(POLL_ERROR_MS);
    } finally {
      loading = false;
    }
  }

  function retryLoad() {
    if (loading) return;
    clearTimeout(pollTimer);
    void load();
  }

  /* ---------- Refresh actions ---------- */

  async function startRefresh(params, source) {
    const input = Model.recordOrEmpty(params);
    const hasUuids = Array.isArray(input.uuids);
    const keys = hasUuids ? input.uuids.map((uuid) => String(uuid).toLowerCase()) : [];
    if (!hasUuids && pending.bulk) return;
    if (hasUuids && (keys.length === 0 || keys.every((key) => pending.keys.has(key)))) return;

    if (hasUuids) for (const key of keys) pending.keys.add(key);
    else {
      pending.bulk = true;
      pending.bulkSource = source || null;
    }
    renderAll();

    let nextPoll = 3_000;
    try {
      const result = Model.recordOrEmpty(await rpc(REFRESH_RPC, params, { keepalive: true, timeoutMs: ACTION_TIMEOUT_MS }));
      const message = typeof result.message === "string" && result.message ? result.message : "主机名刷新任务已加入队列";
      if (result.accepted !== true && result.running !== true) throw new Error(message);
      const current = refreshState();
      view.data.plugin = {
        ...pluginStatus(),
        refresh: {
          ...current,
          running: result.running === true,
          message,
          active_uuids: Array.isArray(result.active_uuids) ? result.active_uuids : current.active_uuids,
          queued_uuids: Array.isArray(result.queued_uuids) ? result.queued_uuids : current.queued_uuids,
          bulk_running: result.bulk_running === true,
          active_jobs: result.active_jobs,
          queued_jobs: result.queued_jobs,
        },
      };
      localRevision += 1;
      if (result.accepted !== true) toast(message, { tone: "info", id: "refresh-info" });
      else if (message.includes("跳过")) toast(message, { tone: "info", id: "refresh-info" });
      nextPoll = POLL_AFTER_ACTION_MS;
    } catch (error) {
      toast(Model.describeError(error, "启动刷新失败").message, { tone: "error", id: "refresh-error" });
    } finally {
      if (hasUuids) for (const key of keys) pending.keys.delete(key);
      else {
        pending.bulk = false;
        pending.bulkSource = null;
      }
      renderAll();
      schedule(nextPoll);
    }
  }

  function refreshNode(key) {
    const row = view.byKey.get(key);
    if (!row || refreshBlockReason(row, taskOf(row)) !== null) return;
    void startRefresh({ force: true, uuids: [row.uuid] });
  }

  async function confirmForceAll() {
    const online = view.counts.online;
    const approved = await requestConfirmation({
      title: "强制刷新全部在线节点",
      message: `将对 ${online} 个在线节点各执行一次固定命令 hostname（系统没有该命令时改用 uname -n），正在刷新或排队的节点不会重复加入。任务在 Komari 后台执行，关闭页面不会中断。`,
      confirmLabel: "开始刷新",
      icon: "#i-zap",
    });
    if (approved) void startRefresh({ force: true }, "force");
  }

  async function copyHostname(key) {
    const row = view.byKey.get(key);
    if (!row?.hostname) return;
    const copied = await copyText(row.hostname);
    toast(copied ? `已复制主机名 ${row.hostname}` : "无法访问剪贴板，请在详情中手动选择复制", { tone: copied ? "success" : "warn", id: "copy", duration: 2200 });
  }

  /* ---------- Events ---------- */

  el.list.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const li = target?.closest(".row");
    if (!li || !el.list.contains(li)) return;
    const key = li.dataset.key;
    if (target.closest(".row-refresh")) {
      refreshNode(key);
      return;
    }
    if (target.closest(".hostname")) {
      void copyHostname(key);
      return;
    }
    // Releasing a text selection inside a row should not open the drawer.
    const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
    if (selection && !selection.isCollapsed && li.contains(selection.anchorNode)) return;
    openDrawer(key, target.closest("button") || li.querySelector(".row-name"));
  });

  el.list.addEventListener("animationend", (event) => {
    if (event.animationName === "row-flash" && event.target instanceof Element) event.target.classList.remove("is-flashing");
  });

  el.filters.addEventListener("click", (event) => {
    const chip = event.target instanceof Element ? event.target.closest(".chip") : null;
    if (chip) setFilter(chip.dataset.filter);
  });

  el.filters.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const index = Math.max(0, chips.findIndex((chip) => chip.dataset.filter === view.filter));
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = chips.length - 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + chips.length) % chips.length;
    else next = (index + 1) % chips.length;
    event.preventDefault();
    setFilter(chips[next].dataset.filter);
    chips[next].focus();
  });

  // Wait for IME composition (pinyin and the like) to finish before filtering.
  const applySearch = () => {
    view.query = el.search.value;
    syncSearchControls();
    scheduleFilterRender();
  };
  el.search.addEventListener("input", (event) => {
    if (event.isComposing) return;
    applySearch();
  });
  el.search.addEventListener("compositionend", applySearch);

  el.search.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (el.search.value) {
      event.preventDefault();
      el.search.value = "";
      view.query = "";
      syncSearchControls();
      scheduleFilterRender();
    } else {
      el.search.blur();
    }
  });

  el.searchClear.addEventListener("click", () => {
    el.search.value = "";
    view.query = "";
    syncSearchControls();
    scheduleFilterRender();
    el.search.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (modalOpen()) return;
    event.preventDefault();
    el.search.focus();
    el.search.select();
  });

  el.refreshDue.addEventListener("click", () => void startRefresh({ force: false }, "due"));
  el.forceAll.addEventListener("click", () => void confirmForceAll());
  el.activityAction.addEventListener("click", () => setFilter("failed"));
  el.emptyAction.addEventListener("click", () => {
    if (emptyHandler) emptyHandler();
  });
  el.updateAction.addEventListener("click", () => void handleUpdateAction());

  el.confirmCancel.addEventListener("click", () => settleConfirmation(false));
  el.confirmAccept.addEventListener("click", () => settleConfirmation(true));
  el.confirm.addEventListener("cancel", (event) => {
    event.preventDefault();
    settleConfirmation(false);
  });
  el.confirm.addEventListener("close", () => settleConfirmation(false));
  el.confirm.addEventListener("click", (event) => {
    if (event.target === el.confirm) settleConfirmation(false);
  });

  el.drawerClose.addEventListener("click", closeDrawer);
  el.drawer.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDrawer();
  });
  el.drawer.addEventListener("close", onDrawerClosed);
  el.drawer.addEventListener("click", (event) => {
    if (event.target === el.drawer) closeDrawer();
  });
  el.drawerRefresh.addEventListener("click", () => {
    if (view.selected) refreshNode(view.selected);
  });
  el.drawerCopyHost.addEventListener("click", async () => {
    const row = view.selected ? view.byKey.get(view.selected) : null;
    if (!row?.hostname) return;
    if (await copyText(row.hostname)) showCopied(el.drawerCopyHost);
    else setText(el.drawerNote, "无法访问剪贴板，请手动选择主机名复制。");
  });
  el.drawerUuid.addEventListener("click", async () => {
    const row = view.selected ? view.byKey.get(view.selected) : null;
    if (!row) return;
    if (await copyText(row.uuid)) showCopied(el.drawerUuid);
    else setText(el.drawerNote, "无法访问剪贴板，请手动选择 UUID 复制。");
  });
  el.drawerCopyReport.addEventListener("click", async () => {
    const row = view.selected ? view.byKey.get(view.selected) : null;
    if (!row) return;
    const label = el.drawerCopyReport.querySelector("span");
    if (await copyText(Model.failureReport(row, view.cacheDays))) showCopied(el.drawerCopyReport, label);
    else setText(el.drawerNote, "无法访问剪贴板，请手动选择上方输出复制。");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    void load();
    tick();
  });

  el.filters.addEventListener("scroll", updateFilterFade, { passive: true });

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => {
      placeIndicator(true);
      updateFilterFade();
    });
    observer.observe(el.filters);
    for (const chip of chips) observer.observe(chip);
  } else {
    window.addEventListener("resize", () => {
      placeIndicator(true);
      updateFilterFade();
    });
  }

  function tick() {
    if (document.hidden || !view.loaded) return;
    const now = Date.now();
    for (const row of view.visible) {
      const item = rowItems.get(row.key);
      if (item) paintTime(item, row, now);
    }
    renderActivity();
    renderDrawer();
  }

  setInterval(tick, TICK_MS);

  renderUpdater();
  consumeUpdateReloadMarker();
  syncSearchControls();
  renderAll();
  placeIndicator(true);
  updateFilterFade();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      placeIndicator(true);
      updateFilterFade();
    }).catch(() => {});
  }
  void load();
})();
