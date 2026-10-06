import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (name: string) => fs.readFileSync(new URL(`../pages/${name}`, import.meta.url), "utf8");
const html = read("index.html");
const script = read("index.js");
const modelSource = read("model.js");
const themeSource = read("theme.js");
const styles = read("index.css");
const manifest = JSON.parse(fs.readFileSync(new URL("../komari-plugin.json", import.meta.url), "utf8")) as {
  version: string;
  permissions: Record<string, unknown>;
  configuration: { data: Array<{ key?: string }> };
};
const packageInfo = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string; komari: { files: string[] } };

type Row = {
  uuid: string; key: string; name: string; region: string; weight: number; online: boolean; hostname: string;
  collectedAt: number | null; attemptAt: number | null; error: string; state: string; os: string; version: string;
  failure: { stage: string; taskId: string; rpcCode: number | null; exitCode: number | null; output: string } | null;
};
type Model = Record<string, (...args: any[]) => any> & { DAY_MS: number; FILTERS: string[] };

function loadModel(): Model {
  const context = vm.createContext({ Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, TypeError });
  vm.runInContext(modelSource, context, { filename: "pages/model.js" });
  return (context as { OnaniModel: Model }).OnaniModel;
}

const model = loadModel();
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-06T08:00:00.000Z");

function fixture() {
  return {
    nodes: {
      "F9E79538-E4A8-43B2-8E58-A1857C82CC5F": { name: "TX 上海", weight: 10, region: "🇨🇳", token: "never-shown" },
      "d32ff8ca-7745-405a-b6f8-08950f885614": { name: "HostDzire Win", weight: 20, region: "🇨🇦", os: "Windows 11", version: "1.5.11" },
      "234b189c-36dc-4e57-8ec4-a89a8db5c1f1": { name: "NETCUP 美东", weight: 30, region: "us" },
      "5a5d1f0e-0000-4000-8000-000000000001": { name: "  ", weight: 30 },
      "5a5d1f0e-0000-4000-8000-000000000002": { name: "Alpha 10", weight: 5 },
      "5a5d1f0e-0000-4000-8000-000000000003": { name: "Alpha 9", weight: 5 },
    },
    statuses: {
      "F9E79538-E4A8-43B2-8E58-A1857C82CC5F": { online: true },
      "d32ff8ca-7745-405a-b6f8-08950f885614": { online: true },
      "234b189c-36dc-4e57-8ec4-a89a8db5c1f1": { online: false },
      "5a5d1f0e-0000-4000-8000-000000000002": { online: true },
      "5a5d1f0e-0000-4000-8000-000000000003": { online: "yes" },
    },
    entries: {
      "f9e79538-e4a8-43b2-8e58-a1857c82cc5f": {
        last_attempt_at: new Date(NOW - DAY).toISOString(),
        last_error: "Remote control is disabled.",
        last_failure: { stage: "Agent 执行 hostname", at: new Date(NOW - DAY).toISOString(), task_id: "task-123", exit_code: -1, output: "Remote control is disabled." },
      },
      "d32ff8ca-7745-405a-b6f8-08950f885614": { hostname: "WIN-HOSTDZIRE", collected_at: new Date(NOW - DAY).toISOString() },
      "234b189c-36dc-4e57-8ec4-a89a8db5c1f1": { hostname: "netcup-us-01", collected_at: new Date(NOW - 45 * DAY).toISOString() },
      "5a5d1f0e-0000-4000-8000-000000000003": { hostname: "alpha-9", collected_at: "not a date" },
    },
  };
}

function rows(): Row[] {
  const data = fixture();
  return model.buildRows(data.nodes, data.statuses, data.entries, 30, NOW);
}

test("page markup keeps every script binding and stays free of unsafe sinks", () => {
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML contains duplicate IDs");
  const scriptIds = [...script.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(scriptIds.length > 50, "expected the element map to be parsed");
  for (const id of scriptIds) assert.ok(htmlIds.includes(id), `missing HTML element #${id}`);
  for (const template of ["row-template", "toast-template"]) assert.match(html, new RegExp(`<template id="${template}">`));
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'; script-src 'self'/);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "inline event handlers violate the CSP");
  assert.doesNotMatch(html, /<script>(?!<\/script>)|style="/, "inline scripts and styles violate the CSP");
  for (const [name, source] of [["index.js", script], ["model.js", modelSource], ["theme.js", themeSource]]) {
    assert.doesNotMatch(source, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b|new Function/, `${name} uses an HTML/code sink`);
    assert.doesNotMatch(source, /\blocalStorage\b|\bindexedDB\b|caches\.open|serviceWorker/, `${name} persists data in the browser`);
  }
  assert.doesNotMatch(script, /window\.confirm|window\.alert|\bconfirm\s*\(|\balert\s*\(/);
  assert.doesNotMatch(script, /\.scrollIntoView\(/, "scrollIntoView would also scroll the admin page around the iframe");
  // theme.js must run before first paint, the model before the UI.
  assert.ok(html.indexOf('src="./theme.js"') < html.indexOf("<body>"));
  assert.ok(html.indexOf('src="./model.js"') < html.indexOf('src="./index.js"'));
  assert.match(html, /id="toasts" popover="manual"/);
});

test("refresh, update and copy flows keep their guarantees", () => {
  assert.match(script, /rpc\(REFRESH_RPC, params, \{ keepalive: true/);
  assert.match(script, /releases\/latest\/download\/onani-update\.json/);
  assert.match(script, /PLUGIN_MARKET_API}\/install/);
  assert.match(script, /cache: "no-store"/);
  assert.match(script, /cache: "reload"/);
  assert.match(script, /sessionStorage\?\.removeItem\(UPDATE_RELOAD_MARKER\)/);
  assert.doesNotMatch(script, /\btoken\b/, "the page must never read node tokens");
});

test("self-update reloads exactly the files the page is made of", () => {
  const assets = JSON.parse(script.match(/const PAGE_ASSETS = (\[[^\]]+\]);/)![1].replace(/'/g, "\"")) as string[];
  const files = fs.readdirSync(new URL("../pages/", import.meta.url)).filter((name) => name !== "index.html").map((name) => `./${name}`).sort();
  assert.deepEqual([...assets].sort(), files);
  for (const asset of assets) assert.ok(html.includes(asset.replace("./", "./")), `${asset} is not referenced by index.html`);
});

test("page, package and manifest versions stay synchronized", () => {
  assert.equal(script.match(/const CURRENT_VERSION = "([^"]+)";/)?.[1], manifest.version);
  assert.equal(packageInfo.version, manifest.version);
  assert.match(html, new RegExp(`id="update-current">v${manifest.version.replace(/\./g, "\\.")}<`));
});

test("the retired background feature leaves no permissions, settings or assets behind", () => {
  assert.equal(manifest.permissions.allowRoutes, undefined);
  assert.equal(manifest.permissions.allowExec, undefined);
  assert.equal(manifest.permissions.allowHooks, true);
  assert.equal(manifest.permissions.allowSystemRPC, true);
  assert.ok(manifest.configuration.data.every((item) => !item.key?.startsWith("background_")));
  assert.deepEqual(packageInfo.komari.files, ["pages"]);
  assert.ok(!fs.existsSync(new URL("../pages/background.js", import.meta.url)));
  assert.doesNotMatch(html + script + styles, /background\.js|background_enabled|\/api\/plugins\/onani\/background/);
});

test("styles cover the shell, responsive layouts and reduced motion", () => {
  assert.match(styles, /\.app\s*{[^}]*height:\s*100dvh/s);
  assert.match(styles, /\.list-scroll\s*{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.list-head\s*{[^}]*position:\s*sticky/s);
  assert.match(styles, /@media \(max-width: 680px\)/);
  assert.match(styles, /@media \(max-height: 540px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /:root\[data-theme="dark"\]/);
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  for (const name of ["row-flash", "drawer-in", "sheet-in", "pop-in", "toast-in", "shimmer", "indeterminate"]) {
    assert.match(styles, new RegExp(`@keyframes ${name}\\b`), `missing @keyframes ${name}`);
  }
});

test("semantic versions compare without lexical mistakes", () => {
  assert.equal(model.compareSemver("0.1.10", "0.1.9"), 1);
  assert.equal(model.compareSemver("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(model.compareSemver("1.0.0-rc.2", "1.0.0-rc.10"), -1);
  assert.equal(model.compareSemver("v1.2.3+build.2", "1.2.3+build.1"), 0);
  assert.equal(model.compareSemver("1.0.0-alpha", "1.0.0-1"), 1);
  assert.equal(model.compareSemver("not-a-version", "1.0.0"), null);
  assert.equal(model.compareSemver("01.0.0", "1.0.0"), null);
});

test("regions become two-letter codes regardless of emoji support", () => {
  assert.equal(model.regionCode("🇭🇰"), "HK");
  assert.equal(model.regionCode("🇺🇸"), "US");
  assert.equal(model.regionCode("jp"), "JP");
  assert.equal(model.regionCode("🇭"), "");
  assert.equal(model.regionCode("Hong Kong"), "");
  assert.equal(model.regionCode(undefined), "");
});

test("rows are normalized, keyed by lower-case UUID and sorted like the admin", () => {
  const list = rows();
  assert.deepEqual([...list.map((row) => row.name)], [
    "Alpha 9", "Alpha 10", "TX 上海", "HostDzire Win", "5a5d1f0e-0000-4000-8000-000000000001", "NETCUP 美东",
  ]);
  const tx = list.find((row) => row.name === "TX 上海")!;
  assert.equal(tx.key, "f9e79538-e4a8-43b2-8e58-a1857c82cc5f");
  assert.equal(tx.state, "failed");
  assert.equal(tx.region, "CN");
  assert.equal(tx.failure?.taskId, "task-123");
  assert.equal(tx.failure?.exitCode, -1);
  assert.equal(JSON.stringify(list).includes("never-shown"), false, "tokens must not reach the view model");
  const states = Object.fromEntries(list.map((row) => [row.name, row.state]));
  assert.equal(states["HostDzire Win"], "cached");
  assert.equal(states["NETCUP 美东"], "expired");
  assert.equal(states["Alpha 9"], "expired", "an unparsable collection time is treated as stale");
  assert.equal(states["Alpha 10"], "missing");
  assert.equal(list.find((row) => row.name === "Alpha 9")!.online, false, "only a literal true counts as online");
});

test("counts, filters and multi-term search work on loaded data only", () => {
  const list = rows();
  assert.deepEqual({ ...model.summarize(list) }, { all: 6, cached: 1, failed: 1, missing: 2, expired: 2, offline: 3, online: 3 });
  // Arrays created inside the vm context have their own prototype; copy before comparing.
  const names = (filter: string, query = "") => [...model.filterRows(list, filter, query).map((row: Row) => row.name)];
  assert.deepEqual(names("failed"), ["TX 上海"]);
  assert.deepEqual(names("offline"), ["Alpha 9", "5a5d1f0e-0000-4000-8000-000000000001", "NETCUP 美东"]);
  assert.deepEqual(names("all", "win-host"), ["HostDzire Win"]);
  assert.deepEqual(names("all", "alpha 10"), ["Alpha 10"], "every term must match");
  assert.deepEqual(names("all", "  ALPHA   9 "), ["Alpha 9"]);
  assert.deepEqual(names("all", "us"), ["NETCUP 美东"], "a two-letter term matches the region code");
  assert.deepEqual(names("expired", "netcup"), ["NETCUP 美东"]);
  assert.deepEqual(names("bogus", "a32ff"), [], "unknown filters fall back to all");
  assert.deepEqual(names("all", "d32ff8ca"), ["HostDzire Win"], "UUIDs are searchable");
});

test("row signatures change only with what the row shows", () => {
  const [row] = rows();
  const base = model.rowSignature(row);
  assert.equal(model.rowSignature({ ...row }), base);
  assert.notEqual(model.rowSignature({ ...row, hostname: "changed" }), base);
  assert.notEqual(model.rowSignature({ ...row, online: !row.online }), base);
  assert.notEqual(model.rowSignature({ ...row, error: "new error" }), base);
});

test("task state, progress and the last run are derived from the refresh snapshot", () => {
  const refresh = { running: true, active_uuids: ["AAA"], queued_uuids: ["bbb"], targeted: 4, succeeded: 1, failed: 1, message: "正在刷新 2 个节点" };
  assert.equal(model.taskStateOf("aaa", refresh, new Set()), "active");
  assert.equal(model.taskStateOf("bbb", refresh, new Set()), "queued");
  assert.equal(model.taskStateOf("ccc", refresh, new Set(["ccc"])), "queued");
  assert.equal(model.taskStateOf("ddd", refresh, new Set()), null);
  assert.deepEqual({ ...model.progressOf(refresh) }, { running: true, done: 2, total: 5, ratio: 0.4, message: "正在刷新 2 个节点" });
  assert.equal(model.progressOf({ running: true }).ratio, null, "bulk runs stay indeterminate until targets are known");
  assert.equal(model.lastRefresh(refresh), null, "a running refresh has no result yet");
  const last = model.lastRefresh({ running: false, finished_at: "2026-10-06T07:59:00Z", succeeded: 3, failed: 1, targeted: 4, message: "刷新完成：成功 3，失败 1" });
  assert.equal(last.failed, 1);
  assert.equal(last.finishedAt, Date.parse("2026-10-06T07:59:00Z"));
  assert.equal(model.lastRefresh({ running: false, finished_at: null }), null);
});

test("times read naturally in Chinese and never throw on bad input", () => {
  assert.equal(model.formatRelative(NOW - 10_000, NOW), "刚刚");
  assert.equal(model.formatRelative(NOW - 5 * 60_000, NOW), "5分钟前");
  assert.equal(model.formatRelative(NOW - 3 * 3600_000, NOW), "3小时前");
  assert.equal(model.formatRelative(NOW - DAY, NOW), "昨天");
  assert.equal(model.formatRelative(NOW - 3 * DAY, NOW), "3天前");
  assert.equal(model.formatRelative(NOW + 27 * DAY, NOW), "下个月");
  assert.equal(model.formatRelative(NOW + 3 * DAY, NOW), "3天后");
  assert.equal(model.formatRelative(null, NOW), "—");
  assert.equal(model.formatAbsolute(Number.NaN), "—");
  // The local date and minute depend on the time zone (UTC-12 … UTC+14, +5:45 …); check the shape.
  assert.match(model.formatAbsolute(NOW), /^2026\/10\/0[5-7] \d{2}:\d{2}$/);
  assert.match(model.formatCompact(NOW, NOW), /^10\/0[5-7] \d{2}:\d{2}$/);
  assert.match(model.formatCompact(Date.parse("2025-01-02T00:00:00Z"), NOW), /^2025\//);
});

test("failure reports contain everything needed to investigate", () => {
  const row = rows().find((item) => item.name === "TX 上海")!;
  const report = model.failureReport(row, 30);
  for (const expected of ["节点：TX 上海", "UUID：F9E79538", "失败阶段：Agent 执行 hostname", "任务 ID：task-123", "退出码：-1", "Agent 原始输出", "Remote control is disabled.", "缓存周期：30 天"]) {
    assert.ok(report.includes(expected), `report is missing ${expected}`);
  }
  const legacy = model.failureReport({ ...row, failure: null }, 30);
  assert.match(legacy, /旧记录未保存阶段/);
  assert.match(legacy, /重新刷新可记录更完整的任务信息/);
  assert.equal(model.stateLabel(row), "采集失败");
  assert.equal(model.stateLabel({ ...row, hostname: "old" }), "刷新失败");
});

test("errors are explained in terms an administrator can act on", () => {
  assert.equal(model.describeError({ code: -32601, message: "method not found" }, "x").kind, "not-running");
  assert.equal(model.describeError({ status: 401, message: "HTTP 401" }, "x").kind, "auth");
  assert.equal(model.describeError(new TypeError("Failed to fetch"), "x").kind, "network");
  assert.deepEqual({ ...model.describeError(new Error("database is locked"), "x") }, { kind: "error", message: "database is locked" });
  assert.deepEqual({ ...model.describeError(null, "读取失败") }, { kind: "error", message: "读取失败" });
});
