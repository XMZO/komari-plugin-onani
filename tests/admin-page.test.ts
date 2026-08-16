import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../pages/index.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../pages/index.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../pages/index.css", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../komari-plugin.json", import.meta.url), "utf8")) as { version: string };
const packageInfo = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

type FakeEvent = {
  target: FakeElement;
  defaultPrevented: boolean;
  preventDefault(): void;
};

class FakeElement {
  value = "";
  hidden = false;
  disabled = false;
  open = false;
  textContent = "";
  className = "";
  title = "";
  type = "";
  focused = false;
  children: unknown[] = [];
  private listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  classList = {
    add: (...tokens: string[]) => {
      const classes = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const token of tokens) classes.add(token);
      this.className = [...classes].join(" ");
    },
    remove: (...tokens: string[]) => {
      const removed = new Set(tokens);
      this.className = this.className.split(/\s+/).filter((token) => token && !removed.has(token)).join(" ");
    },
  };

  append(...children: unknown[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: unknown[]): void {
    this.children = [...children];
  }

  insertBefore(child: unknown, reference: unknown): unknown {
    const existingIndex = this.children.indexOf(child);
    if (existingIndex >= 0) this.children.splice(existingIndex, 1);
    const referenceIndex = reference === null ? this.children.length : this.children.indexOf(reference);
    if (referenceIndex < 0) throw new Error("reference child not found");
    this.children.splice(referenceIndex, 0, child);
    return child;
  }

  removeChild(child: unknown): unknown {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error("child not found");
    this.children.splice(index, 1);
    return child;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, target: FakeElement = this): void {
    const event: FakeEvent = {
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  showModal(): void {
    this.open = true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatch("close");
  }

  setAttribute(name: string): void {
    if (name === "open") this.open = true;
  }

  removeAttribute(name: string): void {
    if (name === "open") this.open = false;
  }

  focus(): void {
    this.focused = true;
  }
}

type FakeBrowserState = {
  reloads: number;
  session: Map<string, string>;
};

function createPageContext(): { context: vm.Context; elements: Map<string, FakeElement>; browser: FakeBrowserState } {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  for (const id of ["error", "update-error", "progress", "clear-filters", "empty", "empty-clear"]) {
    elements.get(id)!.hidden = true;
  }
  elements.get("online-filter")!.value = "all";
  elements.get("cache-filter")!.value = "all";

  const document = {
    hidden: true,
    getElementById(id: string) {
      return elements.get(id) ?? null;
    },
    createElement() {
      return new FakeElement();
    },
    createTextNode(text: string) {
      return { textContent: text };
    },
    addEventListener() {},
  };
  const browser: FakeBrowserState = { reloads: 0, session: new Map() };
  const window = {
    setTimeout,
    location: {
      href: "https://komari.example/api/admin/plugin/onani/pages/index.html",
      reload: () => { browser.reloads += 1; },
    },
    sessionStorage: {
      getItem: (key: string) => browser.session.get(key) ?? null,
      setItem: (key: string, value: string) => browser.session.set(key, value),
      removeItem: (key: string) => browser.session.delete(key),
    },
  };
  const context = vm.createContext({
    document,
    window,
    AbortController,
    URL,
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(script, context, { filename: "pages/index.js" });
  return { context, elements, browser };
}

function fixtureData(): Record<string, unknown> {
  const day = 86_400_000;
  return {
    nodes: {
      "f9e79538-e4a8-43b2-8e58-a1857c82cc5f": { name: "TX 上海", weight: 10 },
      "d32ff8ca-7745-405a-b6f8-08950f885614": { name: "HostDzire Win", weight: 20 },
      "234b189c-36dc-4e57-8ec4-a89a8db5c1f1": { name: "NETCUP 美东", weight: 30 },
    },
    statuses: {
      "f9e79538-e4a8-43b2-8e58-a1857c82cc5f": { online: true },
      "d32ff8ca-7745-405a-b6f8-08950f885614": { online: true },
      "234b189c-36dc-4e57-8ec4-a89a8db5c1f1": { online: false },
    },
    pluginStatus: {
      config: { cache_days: 30 },
      refresh: { running: false },
      entries: {
        "f9e79538-e4a8-43b2-8e58-a1857c82cc5f": {
          last_attempt_at: new Date(Date.now() - day).toISOString(),
          last_error: "Remote control is disabled.",
        },
        "d32ff8ca-7745-405a-b6f8-08950f885614": {
          hostname: "WIN-HOSTDZIRE",
          collected_at: new Date(Date.now() - day).toISOString(),
        },
        "234b189c-36dc-4e57-8ec4-a89a8db5c1f1": {
          hostname: "netcup-us-01",
          collected_at: new Date(Date.now() - 45 * day).toISOString(),
        },
      },
    },
  };
}

test("admin page keeps every script binding present and avoids unsafe HTML sinks", () => {
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const scriptIds = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML contains duplicate IDs");
  for (const id of scriptIds) assert.ok(htmlIds.includes(id), `missing HTML element #${id}`);
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tabpanel"/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(script, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
  assert.match(script, /rpc\(REFRESH_RPC, params, \{ keepalive: true \}\)/);
  assert.match(script, /releases\/latest\/download\/onani-update\.json/);
  assert.match(script, /PLUGIN_MARKET_API}\/install/);
  assert.match(script, /cache: "no-store"/);
  assert.match(script, /cache: "reload"/);
  assert.match(script, /sessionStorage\?\.removeItem\(UPDATE_RELOAD_MARKER\)/);
  assert.doesNotMatch(script, /首次检查更新需要向 Komari 添加/);
  assert.doesNotMatch(script, /window\.confirm|\bconfirm\s*\(/);
  assert.doesNotMatch(script, /\blocalStorage\b|\bindexedDB\b|caches\.open|serviceWorker/);
  assert.match(html, /id="update-card"/);
  assert.match(html, /id="update-action"/);
  assert.match(html, /<dialog[\s\S]*?id="confirm-dialog"/);
  assert.match(styles, /\.confirm-dialog::backdrop/);
  assert.match(html, /id="table-wrap"[\s\S]*?role="region"[\s\S]*?tabindex="0"/);
  assert.match(styles, /\.table-wrap\s*{[^}]*max-height:[^}]*overflow:\s*auto/s);
  assert.match(styles, /th\s*{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.feedback\s*{[^}]*position:\s*fixed/s);
  assert.match(styles, /@keyframes\s+notice-enter/);
  assert.match(styles, /@keyframes\s+notice-leave/);
  assert.match(styles, /@keyframes\s+row-updated/);
  assert.match(styles, /@keyframes\s+busy-spin/);
  assert.match(styles, /@keyframes\s+confirm-exit/);
  assert.match(styles, /@keyframes\s+content-updated/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("page, package and manifest versions stay synchronized", () => {
  const currentVersion = script.match(/const CURRENT_VERSION = "([^"]+)";/)?.[1];
  assert.equal(currentVersion, manifest.version);
  assert.equal(packageInfo.version, manifest.version);
  assert.match(html, new RegExp(`id="update-current">v${manifest.version.replace(/\./g, "\\.")}<`));
});

test("updater compares stable and prerelease versions without lexical mistakes", () => {
  const { context } = createPageContext();
  const comparisons = vm.runInContext(`JSON.stringify([
    compareSemver("0.1.10", "0.1.9"),
    compareSemver("1.0.0", "1.0.0-rc.1"),
    compareSemver("1.0.0-rc.2", "1.0.0-rc.10"),
    compareSemver("v1.2.3+build.2", "1.2.3+build.1"),
    compareSemver("not-a-version", "1.0.0"),
  ])`, context) as string;
  assert.deepEqual(JSON.parse(comparisons), [1, 1, -1, 0, null]);
});

test("confirmations stay inside the page and resolve only from dialog actions", async () => {
  const { context, elements } = createPageContext();
  const dialog = elements.get("confirm-dialog")!;

  const cancelled = vm.runInContext(`requestConfirmation({
    title: "更新到 v0.1.9",
    message: "测试确认内容",
    confirmLabel: "开始更新",
  })`, context) as Promise<boolean>;
  assert.equal(dialog.open, true);
  assert.equal(elements.get("confirm-title")!.textContent, "更新到 v0.1.9");
  assert.equal(elements.get("confirm-message")!.textContent, "测试确认内容");
  assert.equal(elements.get("confirm-accept")!.textContent, "开始更新");
  assert.equal(elements.get("confirm-cancel")!.focused, true);
  elements.get("confirm-cancel")!.dispatch("click");
  assert.match(dialog.className, /\bclosing\b/);
  assert.equal(await cancelled, false);
  assert.equal(dialog.open, false);
  assert.doesNotMatch(dialog.className, /\bclosing\b/);

  const accepted = vm.runInContext(`requestConfirmation({
    title: "强制刷新全部在线节点",
    message: "测试确认内容",
  })`, context) as Promise<boolean>;
  elements.get("confirm-accept")!.dispatch("click");
  assert.equal(await accepted, true);
  assert.equal(dialog.open, false);
});

test("self-update source registration is automatic and idempotent", async () => {
  const { context } = createPageContext();
  const requests: Array<{ path: string; method: string }> = [];
  const sources: Array<Record<string, unknown>> = [];
  (context as Record<string, unknown>).fetch = async (resource: unknown, init?: { method?: string }) => {
    const path = String(resource);
    const method = init?.method || "GET";
    requests.push({ path, method });
    if (path.endsWith("/sources") && method === "GET") {
      return { ok: true, status: 200, json: async () => ({ status: "success", data: sources }) };
    }
    if (path.endsWith("/sources") && method === "POST") {
      const source = {
        id: "onani-source",
        name: "Onani Updates",
        url: "https://github.com/XMZO/komari-plugin-onani/releases/latest/download/onani-update.json",
        enabled: true,
      };
      sources.push(source);
      return { ok: true, status: 200, json: async () => ({ status: "success", data: source }) };
    }
    throw new Error(`unexpected request: ${method} ${path}`);
  };

  const first = await vm.runInContext("ensureUpdateSource()", context) as Record<string, unknown>;
  const second = await vm.runInContext("ensureUpdateSource()", context) as Record<string, unknown>;
  assert.equal(first.id, "onani-source");
  assert.equal(second.id, "onani-source");
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
});

test("update check selects only the private source and compares the installed version", async () => {
  const { context, elements } = createPageContext();
  const source = {
    id: "onani-source",
    name: "Onani Updates",
    url: "https://github.com/XMZO/komari-plugin-onani/releases/latest/download/onani-update.json",
    enabled: true,
  };
  (context as Record<string, unknown>).fetch = async (resource: unknown, init?: { body?: string; method?: string }) => {
    const path = String(resource);
    if (path === "/api/rpc2") {
      const request = JSON.parse(init?.body || "{}") as { method?: string };
      assert.equal(request.method, "admin:listPlugins");
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", result: [{ short: "onani", version: "0.1.8" }] }),
      };
    }
    if (path.endsWith("/sources")) {
      return { ok: true, status: 200, json: async () => ({ status: "success", data: [source] }) };
    }
    if (path.includes("/catalog?refresh=true")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: {
            sources: [{ id: "official", error: "ignored" }, { id: source.id, count: 1 }],
            plugins: [
              { short: "onani", version: "9.9.9", source_id: "official", installable: true },
              { short: "onani", version: "0.1.9", source_id: source.id, installable: true },
            ],
          },
        }),
      };
    }
    throw new Error(`unexpected request: ${path}`);
  };

  await vm.runInContext("checkForUpdates()", context);
  const state = JSON.parse(vm.runInContext("JSON.stringify({ updateMode, currentVersion, availableUpdate })", context) as string);
  assert.deepEqual(state, {
    updateMode: "available",
    currentVersion: "0.1.8",
    availableUpdate: { sourceId: "onani-source", version: "0.1.9" },
  });
  assert.equal(elements.get("update-action")!.textContent, "更新到 v0.1.9");
});

test("successful update reloads fixed asset URLs and leaves only a transient marker", async () => {
  const { context, elements, browser } = createPageContext();
  const assetRequests: Array<{ path: string; cache?: string }> = [];
  (context as Record<string, unknown>).fetch = async (
    resource: unknown,
    init?: { body?: string; cache?: string; method?: string },
  ) => {
    const path = String(resource);
    if (path.endsWith("/market/install")) {
      const body = JSON.parse(init?.body || "{}") as Record<string, unknown>;
      assert.deepEqual(body, { source_id: "onani-source", short: "onani" });
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "success", data: { short: "onani", version: "0.1.9" } }),
      };
    }
    if (path.endsWith("/index.css") || path.endsWith("/index.js")) {
      assetRequests.push({ path, cache: init?.cache });
      return { ok: true, status: 200 };
    }
    throw new Error(`unexpected request: ${path}`);
  };

  vm.runInContext(`
    currentVersion = "0.1.8";
    updateMode = "available";
    availableUpdate = { sourceId: "onani-source", version: "0.1.9" };
    renderUpdater();
  `, context);
  const install = vm.runInContext("installAvailableUpdate()", context) as Promise<void>;
  assert.equal(elements.get("confirm-dialog")!.open, true);
  elements.get("confirm-accept")!.dispatch("click");
  await install;

  assert.equal(browser.reloads, 1);
  assert.equal(browser.session.get("onani:updated-version"), "0.1.9");
  assert.deepEqual(assetRequests.map((request) => request.cache), ["reload", "reload"]);
  assert.deepEqual(assetRequests.map((request) => new URL(request.path).pathname).sort(), [
    "/api/admin/plugin/onani/pages/index.css",
    "/api/admin/plugin/onani/pages/index.js",
  ]);
});

test("hostname search and filters operate only on the loaded view data", () => {
  const { context } = createPageContext();
  const data = JSON.stringify(fixtureData());
  const result = vm.runInContext(`(() => {
    const data = ${data};
    const rows = nodeRows(data.nodes, data.statuses, data.pluginStatus.entries, 30);
    return JSON.stringify({
      windows: filterRows(rows, { query: "win-host", online: "all", cache: "all" }).map((row) => row.name),
      online: filterRows(rows, { query: "", online: "online", cache: "all" }).map((row) => row.name),
      failed: filterRows(rows, { query: "", online: "all", cache: "failed" }).map((row) => row.name),
      expired: filterRows(rows, { query: "", online: "all", cache: "expired" }).map((row) => row.name),
    });
  })()`, context) as string;
  assert.deepEqual(JSON.parse(result), {
    windows: ["HostDzire Win"],
    online: ["TX 上海", "HostDzire Win"],
    failed: ["TX 上海"],
    expired: ["NETCUP 美东"],
  });
});

test("rendering updates counts and empty state without requesting new data", () => {
  const { context, elements } = createPageContext();
  vm.runInContext(`viewState = ${JSON.stringify(fixtureData())}; renderCurrentView();`, context);
  assert.equal(elements.get("node-list")!.children.length, 3);
  assert.equal(elements.get("result-count")!.textContent, "3 个节点");

  elements.get("hostname-search")!.value = "WIN-HOSTDZIRE";
  vm.runInContext("renderCurrentView();", context);
  assert.equal(elements.get("node-list")!.children.length, 1);
  assert.equal(elements.get("result-count")!.textContent, "显示 1 / 3");
  assert.equal(elements.get("clear-filters")!.hidden, false);

  elements.get("hostname-search")!.value = "does-not-exist";
  vm.runInContext("renderCurrentView();", context);
  assert.equal(elements.get("table-wrap")!.hidden, true);
  assert.equal(elements.get("empty")!.hidden, false);
  assert.equal(elements.get("empty-title")!.textContent, "没有匹配的节点");

  vm.runInContext("clearFilters();", context);
  assert.equal(elements.get("node-list")!.children.length, 3);
  assert.equal(elements.get("hostname-search")!.focused, true);
});

test("each node gets one consistent forced refresh action", () => {
  const { context, elements } = createPageContext();
  vm.runInContext(`viewState = ${JSON.stringify(fixtureData())}; renderCurrentView();`, context);

  const rows = elements.get("node-list")!.children as FakeElement[];
  const actionButton = (row: FakeElement) => (row.children[4] as FakeElement).children[0] as FakeElement;

  assert.equal(actionButton(rows[0]).textContent, "强制刷新");
  assert.equal(actionButton(rows[0]).disabled, false);
  assert.equal(actionButton(rows[1]).textContent, "强制刷新");
  assert.equal(actionButton(rows[1]).disabled, false);
  assert.equal(actionButton(rows[2]).textContent, "强制刷新");
  assert.equal(actionButton(rows[2]).disabled, true);
});

test("view fingerprint ignores unrelated live metrics but tracks visible state", () => {
  const { context } = createPageContext();
  const data = JSON.stringify(fixtureData());
  const result = vm.runInContext(`(() => {
    const base = ${data};
    const metricsOnly = JSON.parse(JSON.stringify(base));
    metricsOnly.statuses["f9e79538-e4a8-43b2-8e58-a1857c82cc5f"].cpu = 98.7;
    const onlineChanged = JSON.parse(JSON.stringify(base));
    onlineChanged.statuses["f9e79538-e4a8-43b2-8e58-a1857c82cc5f"].online = false;
    const taskChanged = JSON.parse(JSON.stringify(base));
    taskChanged.pluginStatus.refresh.running = true;
    taskChanged.pluginStatus.refresh.active_uuids = ["f9e79538-e4a8-43b2-8e58-a1857c82cc5f"];
    return JSON.stringify({
      base: viewFingerprint(base.nodes, base.statuses, base.pluginStatus),
      metricsOnly: viewFingerprint(metricsOnly.nodes, metricsOnly.statuses, metricsOnly.pluginStatus),
      onlineChanged: viewFingerprint(onlineChanged.nodes, onlineChanged.statuses, onlineChanged.pluginStatus),
      taskChanged: viewFingerprint(taskChanged.nodes, taskChanged.statuses, taskChanged.pluginStatus),
    });
  })()`, context) as string;
  const fingerprints = JSON.parse(result) as Record<string, string>;
  assert.equal(fingerprints.metricsOnly, fingerprints.base);
  assert.notEqual(fingerprints.onlineChanged, fingerprints.base);
  assert.notEqual(fingerprints.taskChanged, fingerprints.base);
});

test("hostname changes replace only the affected row", () => {
  const { context, elements } = createPageContext();
  const data = fixtureData();
  vm.runInContext(`viewState = ${JSON.stringify(data)}; renderCurrentView();`, context);
  const before = [...elements.get("node-list")!.children];

  vm.runInContext(`
    viewState.pluginStatus.entries["d32ff8ca-7745-405a-b6f8-08950f885614"].hostname = "WIN-HOSTDZIRE-NEW";
    renderCurrentView();
  `, context);
  const afterHostname = [...elements.get("node-list")!.children];
  assert.equal(afterHostname[0], before[0]);
  assert.notEqual(afterHostname[1], before[1]);
  assert.equal(afterHostname[2], before[2]);

  vm.runInContext(`
    viewState.pluginStatus.refresh.running = true;
    viewState.pluginStatus.refresh.active_uuids = ["f9e79538-e4a8-43b2-8e58-a1857c82cc5f"];
    viewState.pluginStatus.refresh.queued_uuids = [];
    viewState.pluginStatus.refresh.bulk_running = false;
    renderCurrentView();
  `, context);
  const afterRunning = [...elements.get("node-list")!.children];
  assert.deepEqual(afterRunning, afterHostname);
  const buttons = (afterRunning as FakeElement[])
    .map((row) => ((row.children[4] as FakeElement).children[0] as FakeElement));
  assert.deepEqual(buttons.map((button) => button.textContent), ["刷新中", "强制刷新", "强制刷新"]);
  assert.deepEqual(buttons.map((button) => button.disabled), [true, false, true]);
  assert.equal(elements.get("refresh-due")!.disabled, false);
  assert.equal(elements.get("force-all")!.disabled, false);

  vm.runInContext(`
    viewState.pluginStatus.refresh.queued_uuids = ["d32ff8ca-7745-405a-b6f8-08950f885614"];
    renderCurrentView();
  `, context);
  assert.deepEqual(elements.get("node-list")!.children, afterRunning);
  assert.equal(buttons[1].textContent, "排队中");
  assert.equal(buttons[1].disabled, true);

  vm.runInContext(`viewState.pluginStatus.refresh.bulk_running = true; renderCurrentView();`, context);
  assert.deepEqual(elements.get("node-list")!.children, afterRunning);
  assert.equal(elements.get("refresh-due")!.disabled, true);
  assert.equal(elements.get("force-all")!.disabled, true);
});
