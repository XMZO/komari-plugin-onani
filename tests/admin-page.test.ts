import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../pages/index.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../pages/index.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../pages/index.css", import.meta.url), "utf8");

class FakeElement {
  value = "";
  hidden = false;
  disabled = false;
  textContent = "";
  className = "";
  title = "";
  type = "";
  focused = false;
  children: unknown[] = [];
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

  addEventListener(): void {}

  focus(): void {
    this.focused = true;
  }
}

function createPageContext(): { context: vm.Context; elements: Map<string, FakeElement> } {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  for (const id of ["error", "progress", "clear-filters", "empty", "empty-clear"]) {
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
  const context = vm.createContext({
    document,
    window: { confirm: () => true },
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(script, context, { filename: "pages/index.js" });
  return { context, elements };
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
  assert.match(html, /id="table-wrap"[\s\S]*?role="region"[\s\S]*?tabindex="0"/);
  assert.match(styles, /\.table-wrap\s*{[^}]*max-height:[^}]*overflow:\s*auto/s);
  assert.match(styles, /th\s*{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.feedback\s*{[^}]*position:\s*fixed/s);
  assert.match(styles, /@keyframes\s+notice-enter/);
  assert.match(styles, /@keyframes\s+notice-leave/);
  assert.match(styles, /@keyframes\s+row-updated/);
  assert.match(styles, /@keyframes\s+busy-spin/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
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
