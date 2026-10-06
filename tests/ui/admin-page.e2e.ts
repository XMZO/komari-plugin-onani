import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Frame, type Page } from "playwright-core";

import { FakeKomari, PAGE_PATH, startHarness, type Harness, type HostOptions } from "./harness";

// Opt-in browser tests (`pnpm run test:ui`). They drive the real pages/ files inside a
// replica of Komari's admin iframe and a fake backend. Browsers come from the local
// Playwright cache; pick them with ONANI_UI_BROWSERS=chromium,firefox,webkit.

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit };
const requested = (process.env.ONANI_UI_BROWSERS || "chromium,firefox,webkit").split(",").map((name) => name.trim()).filter(Boolean);
const TIMEOUT = 60_000;

type Session = {
  harness: Harness;
  komari: FakeKomari;
  context: BrowserContext;
  page: Page;
  frame: Frame;
  errors: string[];
  close(): Promise<void>;
};

type OpenOptions = HostOptions & {
  komari?: FakeKomari;
  viewport?: { width: number; height: number };
  reducedMotion?: boolean;
  expectError?: boolean;
};

async function pluginFrame(page: Page): Promise<Frame> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const frame = page.frames().find((item) => item.url().includes(PAGE_PATH));
    if (frame) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error("plugin iframe did not load");
}

async function open(browser: Browser, engine: string, options: OpenOptions = {}): Promise<Session> {
  const komari = options.komari ?? new FakeKomari({ count: 24 });
  const harness = await startHarness(komari);
  harness.hostOptions.dark = options.dark;
  harness.hostOptions.accent = options.accent;
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 800 },
    reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
  });
  if (engine === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: harness.origin });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  await page.goto(`${harness.origin}/admin`);
  const frame = await pluginFrame(page);
  await frame.waitForSelector(options.expectError ? '#app[data-view="error"]' : '#app[data-view="ready"]', { timeout: 10_000 });
  return {
    harness, komari, context, page, frame, errors,
    close: async () => {
      await context.close();
      await harness.close();
    },
  };
}

function rowSelector(uuid: string): string {
  return `.row[data-key="${uuid.toLowerCase()}"]`;
}

async function visibleRowKeys(frame: Frame): Promise<string[]> {
  return frame.$$eval("#list > .row", (rows) => rows.map((row) => (row as HTMLElement).dataset.key || ""));
}

async function waitText(frame: Frame, selector: string, pattern: RegExp, timeout = 8_000): Promise<void> {
  await frame.waitForFunction(
    ([css, source, flags]) => new RegExp(source, flags).test(document.querySelector(css)?.textContent || ""),
    [selector, pattern.source, pattern.flags] as const,
    { timeout },
  );
}

/** Polls a condition on the fake backend (outside the browser). */
async function waitUntil(check: () => boolean, label: string, timeout = 8_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function refreshCalls(komari: FakeKomari) {
  return komari.calls.filter((call) => call.method === "plugin:onani.hostname.refresh");
}

function lastRefreshParams(komari: FakeKomari): unknown {
  const calls = refreshCalls(komari);
  return calls[calls.length - 1]?.params;
}

for (const engine of requested) {
  describe(`admin page in ${engine}`, () => {
    let browser: Browser | null = null;
    let unavailable = "";

    before(async () => {
      const type = ENGINES[engine];
      if (!type) {
        unavailable = `unknown engine ${engine}`;
        return;
      }
      try {
        browser = await type.launch();
      } catch (error) {
        unavailable = error instanceof Error ? error.message.split("\n")[0] : String(error);
      }
    });

    after(async () => {
      await browser?.close();
    });

    const it = (name: string, body: (browser: Browser) => Promise<void>) => test(name, { timeout: TIMEOUT }, async (t) => {
      if (!browser) {
        t.skip(`${engine} unavailable: ${unavailable}`);
        return;
      }
      await body(browser);
    });

    it("loads every node inside the admin iframe without errors, overflow or leaked tokens", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari } = session;
        await frame.waitForFunction(() => document.querySelectorAll("#list > .row").length === 24);
        await waitText(frame, '[data-count="all"]', /^24$/);
        const expected = { cached: 0, failed: 0, missing: 0, expired: 0, offline: 0 };
        const now = Date.now();
        for (const uuid of komari.uuids()) {
          const entry = komari.entries[uuid] || {};
          if (komari.statuses[uuid].online !== true) expected.offline += 1;
          if (entry.last_error) expected.failed += 1;
          else if (!entry.hostname) expected.missing += 1;
          else if (now - Date.parse(entry.collected_at || "") >= 30 * 86_400_000) expected.expired += 1;
          else expected.cached += 1;
        }
        for (const [key, value] of Object.entries(expected)) {
          await waitText(frame, `[data-count="${key}"]`, new RegExp(`^${value}$`));
        }
        assert.equal(await frame.getAttribute("#coverage", "data-visible"), "true");
        assert.match(await frame.textContent("#activity-count") || "", /24 个节点/);
        const html = await frame.content();
        assert.equal(html.includes("secret-token"), false, "node tokens must never reach the page");
        const metrics = await frame.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        }));
        assert.ok(metrics.scrollWidth <= metrics.clientWidth, "no horizontal overflow");
        assert.ok(metrics.scrollHeight <= metrics.clientHeight + 1, "the page itself must not scroll on desktop");
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("follows the admin's dark mode and accent colour live", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, page } = session;
        assert.equal(await frame.getAttribute("html", "data-theme"), "light");
        assert.equal(await frame.evaluate(() => document.documentElement.style.getPropertyValue("--accent")), "#5b5bd6");
        await page.evaluate(() => document.documentElement.classList.add("dark"));
        await frame.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        await frame.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(10, 10, 10)");
        await page.evaluate(() => {
          (document.querySelector(".radix-themes") as HTMLElement).dataset.accentColor = "jade";
        });
        await frame.waitForFunction(() => document.documentElement.style.getPropertyValue("--accent") === "#29a383");
        await page.evaluate(() => document.documentElement.classList.remove("dark"));
        await frame.waitForFunction(() => document.documentElement.dataset.theme === "light");
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("filters by chip, arrow keys and multi-term search, with a recoverable empty state", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari } = session;
        const failed = komari.uuids().filter((uuid) => komari.entries[uuid]?.last_error).map((uuid) => uuid.toLowerCase());
        await frame.click('.chip[data-filter="failed"]');
        await frame.waitForFunction((count) => document.querySelectorAll("#list > .row").length === count, failed.length);
        assert.deepEqual((await visibleRowKeys(frame)).sort(), [...failed].sort());
        assert.equal(await frame.getAttribute('.chip[data-filter="failed"]', "aria-checked"), "true");
        assert.match(await frame.textContent("#activity-count") || "", new RegExp(`${failed.length} / 24`));

        await frame.press('.chip[data-filter="failed"]', "ArrowRight");
        assert.equal(await frame.getAttribute('.chip[data-filter="missing"]', "aria-checked"), "true");
        assert.equal(await frame.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.filter), "missing");

        await frame.click('.chip[data-filter="all"]');
        await frame.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await frame.press("body", "/");
        assert.equal(await frame.evaluate(() => document.activeElement?.id), "search");
        await frame.fill("#search", "ciallo epyc");
        await frame.waitForFunction(() => document.querySelectorAll("#list > .row").length === 1);
        assert.equal(await frame.isVisible("#search-clear"), true);
        await frame.press("#search", "Escape");
        await frame.waitForFunction(() => document.querySelectorAll("#list > .row").length === 24);
        assert.equal(await frame.inputValue("#search"), "");

        await frame.fill("#search", "zzz-no-such-node");
        await frame.waitForSelector("#empty:not([hidden])");
        assert.match(await frame.textContent("#empty-title") || "", /没有匹配的节点/);
        await frame.click("#empty-action");
        await frame.waitForFunction(() => document.querySelectorAll("#list > .row").length === 24);
        assert.equal(await frame.inputValue("#search"), "");
        assert.equal(await frame.evaluate(() => document.activeElement?.id), "search");
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("refreshes one node, shows its progress and blocks offline nodes", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari } = session;
        const target = komari.uuids().find((uuid) => komari.statuses[uuid].online && komari.entries[uuid]?.hostname && !komari.entries[uuid]?.last_error)!;
        const offline = komari.uuids().find((uuid) => komari.statuses[uuid].online !== true)!;
        assert.equal(await frame.isDisabled(`${rowSelector(offline)} .row-refresh`), true);

        await frame.click(`${rowSelector(target)} .row-refresh`);
        await waitUntil(() => refreshCalls(komari).length > 0, "the single-node refresh request");
        await frame.waitForFunction((selector) => document.querySelector(selector)?.getAttribute("data-task") === "active", rowSelector(target));
        assert.deepEqual(lastRefreshParams(komari), { force: true, uuids: [target] });
        assert.match(await frame.textContent(`${rowSelector(target)} .pill-label`) || "", /刷新中/);
        assert.equal(await frame.isDisabled(`${rowSelector(target)} .row-refresh`), true);
        assert.equal(await frame.isDisabled("#refresh-due"), false, "single-node refreshes do not block bulk actions");

        komari.finishRefresh();
        await frame.waitForFunction((selector) => !document.querySelector(selector)?.hasAttribute("data-task"), rowSelector(target), { timeout: 8_000 });
        assert.match(await frame.textContent(`${rowSelector(target)} .pill-label`) || "", /正常/);
        assert.match(await frame.textContent(`${rowSelector(target)} .time`) || "", /刚刚/);
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("runs bulk refreshes with confirmation and leaves a clickable summary", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari } = session;
        await frame.click("#refresh-due");
        await frame.waitForSelector('#activity[data-state="running"]');
        assert.deepEqual(lastRefreshParams(komari), { force: false });
        await frame.waitForFunction(() => (document.getElementById("refresh-due") as HTMLButtonElement).disabled);
        assert.equal(await frame.isDisabled("#force-all"), true);

        const victim = komari.uuids().find((uuid) => komari.statuses[uuid].online && !komari.entries[uuid]?.hostname)!;
        komari.finishRefresh({ [victim]: "Agent 返回退出码 127：sh: hostname: not found" });
        await waitText(frame, "#activity-text", /上次刷新/, 8_000);
        await frame.waitForSelector('.toast:has-text("刷新完成")');
        await frame.waitForSelector("#activity-action:not([hidden])");
        await frame.click("#activity-action");
        assert.equal(await frame.getAttribute('.chip[data-filter="failed"]', "aria-checked"), "true");
        assert.ok((await visibleRowKeys(frame)).includes(victim.toLowerCase()));

        const before = refreshCalls(komari).length;
        await frame.click("#force-all");
        await frame.waitForFunction(() => (document.getElementById("confirm") as HTMLDialogElement).open);
        await frame.click("#confirm-cancel");
        await frame.waitForFunction(() => !(document.getElementById("confirm") as HTMLDialogElement).open);
        assert.equal(refreshCalls(komari).length, before, "cancelling must not start a refresh");

        await frame.click("#force-all");
        await frame.waitForFunction(() => (document.getElementById("confirm") as HTMLDialogElement).open);
        assert.match(await frame.textContent("#confirm-message") || "", /hostname/);
        await frame.click("#confirm-accept");
        await frame.waitForFunction(() => !(document.getElementById("confirm") as HTMLDialogElement).open);
        await waitUntil(() => refreshCalls(komari).length > before, "the forced bulk refresh request");
        assert.deepEqual(lastRefreshParams(komari), { force: true });
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("never lets a poll that was already in flight hide a refresh that just started", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari } = session;
        const statusCalls = () => komari.calls.filter((call) => call.method === "plugin:onani.hostname.status").length;
        // The next poll snapshots "idle" on the server but arrives late.
        komari.methodDelays.set("plugin:onani.hostname.status", 1_200);
        await frame.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        await waitUntil(() => statusCalls() >= 2, "the slow poll to start");
        const before = statusCalls();
        await frame.click("#refresh-due");
        await frame.waitForSelector('#activity[data-state="running"]');
        // Let the stale response land, then require the page to stay in the running state
        // and to poll again quickly instead of waiting for the idle interval.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        assert.equal(await frame.getAttribute("#activity", "data-state"), "running", "a stale poll must not reset the progress");
        await waitUntil(() => statusCalls() >= before + 2, "a fresh poll after the stale one", 5_000);
        komari.methodDelays.clear();
        komari.finishRefresh();
        await waitText(frame, "#activity-text", /上次刷新/, 8_000);
      } finally {
        await session.close();
      }
    });

    it("shows a neutral submitting message instead of the previous run's result", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari } = session;
        await frame.click("#refresh-due");
        await frame.waitForSelector('#activity[data-state="running"]');
        komari.finishRefresh();
        await waitText(frame, "#activity-text", /上次刷新/, 8_000);
        komari.methodDelays.set("plugin:onani.hostname.refresh", 900);
        await frame.click('.chip[data-filter="all"]');
        const forced = frame.click("#force-all").then(() => frame.click("#confirm-accept"));
        await forced;
        await frame.waitForSelector('#activity[data-state="running"]');
        assert.equal(await frame.textContent("#activity-text"), "正在提交刷新任务…");
        komari.methodDelays.clear();
      } finally {
        await session.close();
      }
    });

    it("waits for IME composition before filtering", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame } = session;
        await frame.evaluate(() => {
          const input = document.getElementById("search") as HTMLInputElement;
          input.focus();
          input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
          input.value = "hua";
          input.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "hua", inputType: "insertCompositionText" }));
        });
        await frame.waitForTimeout(150);
        assert.equal(await frame.$$eval("#list > .row", (rows) => rows.length), 24, "intermediate pinyin must not filter");
        await frame.evaluate(() => {
          const input = document.getElementById("search") as HTMLInputElement;
          input.value = "华为云";
          input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "华为云" }));
        });
        await frame.waitForFunction(() => document.querySelectorAll("#list > .row").length === 1);
      } finally {
        await session.close();
      }
    });

    it("shows full diagnostics in the drawer, copies them and restores focus", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari, page } = session;
        const failed = komari.uuids().find((uuid) => komari.entries[uuid]?.last_failure && komari.statuses[uuid].online)!;
        const entry = komari.entries[failed];
        await frame.click(`${rowSelector(failed)} .row-name`);
        await frame.waitForFunction(() => (document.getElementById("drawer") as HTMLDialogElement).open);
        assert.equal(await frame.textContent("#drawer-title"), String(komari.nodes[failed].name));
        assert.equal(await frame.isVisible("#drawer-failure"), true);
        assert.equal(await frame.textContent("#failure-task"), String(entry.last_failure?.task_id));
        assert.equal(await frame.textContent("#failure-reason"), entry.last_error);
        assert.equal(await frame.getAttribute(rowSelector(failed), "aria-current"), "true");

        await frame.click("#drawer-copy-report");
        await waitText(frame, "#drawer-copy-report span", /已复制/);
        if (engine === "chromium") {
          const copied = await frame.evaluate(() => navigator.clipboard.readText());
          assert.match(copied, new RegExp(`任务 ID：${entry.last_failure?.task_id}`));
          assert.match(copied, /UUID：/);
        }

        await page.keyboard.press("Escape");
        await frame.waitForFunction(() => !(document.getElementById("drawer") as HTMLDialogElement).open);
        assert.equal(await frame.getAttribute(rowSelector(failed), "aria-current"), null, "the highlight clears as the drawer closes");
        await frame.waitForFunction((key) => (document.activeElement as HTMLElement | null)?.closest(".row")?.getAttribute("data-key") === key, failed.toLowerCase());

        // A click anywhere on a row opens it; the close button and the backdrop both close it.
        await frame.click(`${rowSelector(failed)} .time`);
        await frame.waitForFunction(() => (document.getElementById("drawer") as HTMLDialogElement).open);
        await frame.click("#drawer-close");
        await frame.waitForFunction(() => !(document.getElementById("drawer") as HTMLDialogElement).open);
        await frame.click(`${rowSelector(failed)} .row-name`);
        await frame.waitForFunction(() => (document.getElementById("drawer") as HTMLDialogElement).open);
        // The left part of the iframe is backdrop while the drawer sits on the right.
        await page.mouse.click(60, 500);
        await frame.waitForFunction(() => !(document.getElementById("drawer") as HTMLDialogElement).open);

        await frame.click(`${rowSelector(failed)} .row-name`);
        await frame.waitForFunction(() => (document.getElementById("drawer") as HTMLDialogElement).open);
        await frame.click("#drawer-refresh");
        await frame.waitForFunction(() => /刷新中|排队中/.test(document.getElementById("drawer-refresh-label")?.textContent || ""));
        assert.deepEqual(lastRefreshParams(komari), { force: true, uuids: [failed] });
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("copies a hostname from the list without opening the drawer", async (instance) => {
      const session = await open(instance, engine);
      try {
        const { frame, komari } = session;
        const target = komari.uuids().find((uuid) => komari.entries[uuid]?.hostname && !komari.entries[uuid]?.last_error)!;
        await frame.click(`${rowSelector(target)} .hostname`);
        await frame.waitForSelector('.toast:has-text("已复制主机名")');
        assert.equal(await frame.evaluate(() => (document.getElementById("drawer") as HTMLDialogElement).open), false);
        if (engine === "chromium") {
          assert.equal(await frame.evaluate(() => navigator.clipboard.readText()), komari.entries[target].hostname);
        }
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("installs an update from the private source and reloads fresh assets", async (instance) => {
      const komari = new FakeKomari({ count: 6 });
      komari.market.latestVersion = "0.3.1";
      komari.market.installedVersion = "0.3.0";
      const session = await open(instance, engine, { komari });
      try {
        const { frame, harness } = session;
        await frame.click("#update-action");
        await waitText(frame, "#update-label", /更新到 v0\.3\.1/);
        assert.equal(komari.market.sources.length, 1, "the update source is registered once");
        await frame.click("#update-action");
        await frame.waitForFunction(() => (document.getElementById("confirm") as HTMLDialogElement).open);
        assert.match(await frame.textContent("#confirm-title") || "", /v0\.3\.1/);
        const assetsBefore = harness.assetRequests.length;
        const reloaded = session.page.waitForEvent("framenavigated", { predicate: (item) => item.url().includes(PAGE_PATH), timeout: 15_000 });
        await frame.click("#confirm-accept");
        await reloaded;
        assert.equal(komari.market.installs, 1);
        const fetched = harness.assetRequests.slice(assetsBefore).map((request) => request.path.split("/").pop());
        for (const asset of ["index.css", "theme.js", "model.js", "index.js"]) assert.ok(fetched.includes(asset), `${asset} was not refetched`);
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("confirms a successful update once after the reload", async (instance) => {
      const komari = new FakeKomari({ count: 4 });
      komari.market.latestVersion = "0.3.0";
      komari.market.installedVersion = "0.2.3";
      const session = await open(instance, engine, { komari });
      try {
        const { frame, page } = session;
        await frame.click("#update-action");
        await waitText(frame, "#update-label", /更新到 v0\.3\.0/);
        await frame.click("#update-action");
        await frame.waitForFunction(() => (document.getElementById("confirm") as HTMLDialogElement).open);
        const reloaded = page.waitForEvent("framenavigated", { predicate: (item) => item.url().includes(PAGE_PATH), timeout: 15_000 });
        await frame.click("#confirm-accept");
        await reloaded;
        const next = await pluginFrame(page);
        await next.waitForSelector('.toast:has-text("已成功更新到 v0.3.0")', { timeout: 10_000 });
        assert.equal(await next.getAttribute("#updater", "data-mode"), "current");
        assert.equal(await next.evaluate(() => sessionStorage.getItem("onani:updated-version")), null);
      } finally {
        await session.close();
      }
    });

    it("explains load failures, the stopped plugin and recovers on retry", async (instance) => {
      const komari = new FakeKomari({ count: 5 });
      komari.failMethods.set("common:getNodes", { code: -32000, message: "database is locked" });
      const session = await open(instance, engine, { komari, expectError: true });
      try {
        const { frame } = session;
        await waitText(frame, "#empty-title", /暂时无法读取数据/);
        assert.match(await frame.textContent("#empty-text") || "", /database is locked/);
        assert.match(await frame.textContent("#activity-text") || "", /自动重试/);
        assert.equal(await frame.isDisabled("#search"), true);
        assert.equal(await frame.getAttribute("#coverage", "data-visible"), "false");

        komari.failMethods.clear();
        komari.failMethods.set("plugin:onani.hostname.status", { code: -32601, message: "method not found" });
        await frame.click("#empty-action");
        await waitText(frame, "#empty-title", /插件未运行/);
        assert.match(await frame.textContent("#empty-text") || "", /批准权限/);

        komari.failMethods.clear();
        await frame.click("#empty-action");
        await frame.waitForSelector('#app[data-view="ready"]');
        await frame.waitForFunction(() => document.querySelectorAll("#list > .row").length === 5);
        assert.equal(await frame.isDisabled("#search"), false);
      } finally {
        await session.close();
      }
    });

    it("keeps every refresh action disabled while discovery is switched off", async (instance) => {
      const komari = new FakeKomari({ count: 6 });
      komari.config.enabled = false;
      const session = await open(instance, engine, { komari });
      try {
        const { frame } = session;
        assert.equal(await frame.isDisabled("#refresh-due"), true);
        assert.equal(await frame.isDisabled("#force-all"), true);
        const disabled = await frame.$$eval(".row-refresh", (buttons) => buttons.every((button) => (button as HTMLButtonElement).disabled));
        assert.equal(disabled, true);
        assert.match(await frame.textContent("#activity-text") || "", /已在插件设置中关闭/);
        assert.match(await frame.textContent("#brand-meta") || "", /主机名采集已关闭/);
      } finally {
        await session.close();
      }
    });

    it("uses cards, a bottom sheet and bottom toasts on phones", async (instance) => {
      const session = await open(instance, engine, { viewport: { width: 390, height: 844 } });
      try {
        const { frame, komari, page } = session;
        assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector(".list-head")!).display), "none");
        assert.equal(await frame.evaluate(() => getComputedStyle(document.querySelector(".row-id")!).display), "none");
        const overflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `horizontal overflow of ${overflow}px`);

        const target = komari.uuids().find((uuid) => komari.entries[uuid]?.hostname && !komari.entries[uuid]?.last_error)!;
        await frame.click(`${rowSelector(target)} .hostname`);
        const toast = await frame.waitForSelector(".toast");
        const viewport = await frame.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
        const toastBox = await toast.boundingBox();
        assert.ok(toastBox && toastBox.y > viewport.height / 2, "toasts sit at the bottom on phones");

        await frame.click(`${rowSelector(target)} .row-name`);
        await frame.waitForFunction(() => (document.getElementById("drawer") as HTMLDialogElement).open);
        await page.waitForTimeout(450);
        const sheet = await frame.evaluate(() => {
          const rect = document.getElementById("drawer")!.getBoundingClientRect();
          return { left: rect.left, right: rect.right, bottom: rect.bottom, top: rect.top };
        });
        assert.ok(Math.abs(sheet.bottom - viewport.height) <= 1, "the drawer is anchored to the bottom");
        assert.ok(sheet.left <= 0.5 && Math.abs(sheet.right - viewport.width) <= 0.5, "the sheet spans the full width");
        assert.ok(sheet.top > 0, "the sheet leaves the backdrop visible above it");
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });

    it("lets short landscape screens scroll the page down to a nearly full-height list", async (instance) => {
      const session = await open(instance, engine, { viewport: { width: 844, height: 390 } });
      try {
        const { frame } = session;
        const metrics = await frame.evaluate(() => ({
          page: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          list: document.getElementById("list-scroll")!.getBoundingClientRect().height,
          viewport: window.innerHeight,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        assert.ok(metrics.page > 0, "the page scrolls when the screen is too short");
        assert.ok(metrics.list <= metrics.viewport, "the list never exceeds one screen");
        assert.ok(metrics.list >= 200, "the list keeps a usable height");
        assert.ok(metrics.overflow <= 0);
      } finally {
        await session.close();
      }
    });

    it("opens and closes overlays instantly with reduced motion", async (instance) => {
      const session = await open(instance, engine, { reducedMotion: true });
      try {
        const { frame, komari, page } = session;
        const target = komari.uuids()[0];
        await frame.click(`${rowSelector(target)} .row-name`);
        assert.equal(await frame.evaluate(() => (document.getElementById("drawer") as HTMLDialogElement).open), true);
        await page.keyboard.press("Escape");
        // WebKit dispatches the cancel event a task after the key press; 200ms is still far
        // below the 220ms closing animation used without reduced motion.
        await frame.waitForFunction(() => !(document.getElementById("drawer") as HTMLDialogElement).open, undefined, { timeout: 200 });
        // Hover transitions still exist but last 1ms; nothing may actually animate.
        const animated = await frame.evaluate(() => document.getAnimations().filter((animation) => {
          const duration = Number(animation.effect?.getTiming().duration);
          return Number.isFinite(duration) && duration > 10;
        }).length);
        assert.equal(animated, 0);
      } finally {
        await session.close();
      }
    });

    it("renders hostile node names and errors as plain text", async (instance) => {
      const komari = new FakeKomari({ count: 3 });
      const [first, second] = komari.uuids();
      komari.nodes[first].name = '<img src=x onerror="window.__owned=1">';
      komari.entries[second] = { last_attempt_at: new Date().toISOString(), last_error: "<script>window.__owned=2</script>" };
      const session = await open(instance, engine, { komari });
      try {
        const { frame } = session;
        assert.equal(await frame.textContent(`${rowSelector(first)} .row-name`), '<img src=x onerror="window.__owned=1">');
        assert.equal(await frame.textContent(`${rowSelector(second)} .row-error-text`), "<script>window.__owned=2</script>");
        assert.equal(await frame.evaluate(() => (window as unknown as { __owned?: number }).__owned), undefined);
        assert.equal(await frame.$$eval("#list img, #list script", (nodes) => nodes.length), 0);
      } finally {
        await session.close();
      }
    });

    it("stays fast with hundreds of nodes", async (instance) => {
      const komari = new FakeKomari({ count: 400 });
      const session = await open(instance, engine, { komari });
      try {
        const { frame } = session;
        await frame.waitForFunction(() => document.querySelectorAll("#list > .row").length === 400);
        const filterMs = await frame.evaluate(async () => {
          const input = document.getElementById("search") as HTMLInputElement;
          const start = performance.now();
          for (const value of ["v", "vp", "vps", "vps.", "vps.t"]) {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }
          return performance.now() - start;
        });
        assert.ok(filterMs < 2_000, `filtering 400 rows took ${Math.round(filterMs)}ms`);
        const pollMs = await frame.evaluate(async () => {
          const start = performance.now();
          document.dispatchEvent(new Event("visibilitychange"));
          await new Promise((resolve) => setTimeout(resolve, 400));
          return performance.now() - start;
        });
        assert.ok(pollMs < 2_000);
        assert.deepEqual(session.errors, []);
      } finally {
        await session.close();
      }
    });
  });
}

// Keep a trivial pass when every requested engine is missing so the runner reports skips clearly.
test("ui harness is wired", async () => {
  const harness = await startHarness(new FakeKomari({ count: 1 }));
  try {
    const response = await fetch(`${harness.origin}${PAGE_PATH}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /节点主机名/);
  } finally {
    await harness.close();
  }
});
