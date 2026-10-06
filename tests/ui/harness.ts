import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A same-origin stand-in for Komari: it serves the real pages/ files at the admin
// plugin path, embeds them like the admin does (iframe below a 96px chrome, same
// sandbox, Radix accent + `.dark` class on <html>) and fakes the RPC/market APIs.

const pagesDir = fileURLToPath(new URL("../../pages/", import.meta.url));
export const PAGE_PATH = "/api/admin/plugin/onani/pages/index.html";
const UPDATE_SOURCE_URL = "https://github.com/XMZO/komari-plugin-onani/releases/latest/download/onani-update.json";
const DAY = 86_400_000;

export type Entry = {
  hostname?: string;
  collected_at?: string;
  last_attempt_at?: string;
  last_error?: string;
  last_failure?: Record<string, unknown>;
};

export type RpcCall = { method: string; params: unknown };

const NAMES = [
  "咕咕云", "七牛云 常山", "TX上海", "ImmortalWrt", "华为云", "hytron", "Ciallo～(∠・ω< )⌒☆ EPYC", "萝莉云", "极点云",
  "isvoro HK CN2 Standard", "vps.town 6c24标准型.HKG-A5m", "vps.town 8c32标准型.HKG-A5m", "BERO-HOST 39o", "HostDzire JP",
  "Oracle SJC ARM FREE", "Cloudnium LA", "alwyzon 大盘", "RFC JP2-CO-Micro", "VMISS 洛杉矶 三网优化", "HostDzire 咖喱32刀",
  "HostDzire SFO", "HostDzire Dedi", "NETCUP 美东", "Hetzner FSN1", "Contabo DE", "GreenCloud SG", "DMIT LAX Pro",
  "Akile DE", "Bandwagon CN2 GIA", "RackNerd 黑五", "LisaHost UK", "Vultr Tokyo", "Linode Fremont", "Hostinger NL",
];
const REGIONS = ["🇨🇳", "🇭🇰", "🇺🇸", "🇯🇵", "🇩🇪", "🇳🇱", "🇸🇬", "🇬🇧", "🇮🇳", "🇨🇦", "🇸🇪", "🇷🇺"];

function uuidFor(index: number): string {
  const hex = (index * 2654435761 >>> 0).toString(16).padStart(8, "0");
  return `${hex}-${(1000 + index).toString(16).padStart(4, "0")}-4${(index % 4096).toString(16).padStart(3, "0")}-8${(index * 7 % 4096).toString(16).padStart(3, "0")}-${(index * 104729).toString(16).padStart(12, "0").slice(-12)}`;
}

export type FixtureOptions = { count?: number; now?: number };

export class FakeKomari {
  nodes: Record<string, Record<string, unknown>> = {};
  statuses: Record<string, Record<string, unknown>> = {};
  entries: Record<string, Entry> = {};
  config = { enabled: true, auto_refresh: true, cache_days: 30, scan_interval_hours: 6, failure_retry_hours: 24 };
  refresh: Record<string, unknown> = { running: false, reason: null, started_at: null, finished_at: null, requested: 0, targeted: 0, succeeded: 0, failed: 0, message: "尚未执行采集", active_uuids: [], queued_uuids: [], bulk_running: false };
  calls: RpcCall[] = [];
  failMethods = new Map<string, { code: number; message: string }>();
  /** Latency added after the response was computed, i.e. the browser gets a stale snapshot. */
  methodDelays = new Map<string, number>();
  /** Pending refresh results applied after `stepRefresh()`. */
  private refreshPlan: Array<{ uuid: string; hostname?: string; error?: string }> = [];
  market = {
    sources: [] as Array<Record<string, unknown>>,
    latestVersion: "0.3.0",
    installedVersion: "0.3.0",
    installs: 0,
    installError: null as string | null,
  };

  constructor(options: FixtureOptions = {}) {
    const now = options.now ?? Date.now();
    const count = options.count ?? 24;
    for (let index = 0; index < count; index += 1) {
      const uuid = uuidFor(index + 1);
      const base = NAMES[index % NAMES.length];
      const name = index < NAMES.length ? base : `${base} #${Math.floor(index / NAMES.length) + 1}`;
      this.nodes[uuid] = {
        uuid, name, weight: index, region: REGIONS[index % REGIONS.length], token: `secret-token-${index}`,
        os: index % 9 === 4 ? "ImmortalWrt 21.02-SNAPSHOT" : index % 11 === 7 ? "Windows 11 IoT Enterprise LTSC 2024" : "Debian GNU/Linux 13 (trixie)",
        version: index % 3 === 0 ? "1.5.11" : "v0.1.52",
      };
      const online = index % 13 !== 5;
      this.statuses[uuid] = { online, cpu: { usage: 12.5 } };
      const hostname = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `node-${index}`;
      if (index % 17 === 3) {
        this.entries[uuid] = {
          last_attempt_at: new Date(now - 2 * 3600_000).toISOString(),
          last_error: "等待 Agent 返回主机名超时（20 秒）；尚未收到结果，无法仅凭超时判断 Agent 是否禁用了远控",
          last_failure: { stage: "等待 Agent 返回结果", at: new Date(now - 2 * 3600_000).toISOString(), task_id: `task-${index}` },
        };
      } else if (index % 17 === 9) {
        this.entries[uuid] = {
          hostname: `${hostname}-old`,
          collected_at: new Date(now - 40 * DAY).toISOString(),
          last_attempt_at: new Date(now - 26 * 3600_000).toISOString(),
          last_error: "Agent 返回退出码 -1：Remote control is disabled.",
          last_failure: { stage: "Agent 执行 hostname", at: new Date(now - 26 * 3600_000).toISOString(), task_id: `task-${index}`, exit_code: -1, output: "Remote control is disabled." },
        };
      } else if (index % 19 === 6) {
        // Missing: never collected.
      } else if (index % 23 === 8) {
        this.entries[uuid] = { hostname, collected_at: new Date(now - 33 * DAY).toISOString() };
      } else {
        this.entries[uuid] = { hostname, collected_at: new Date(now - ((index * 37) % 29) * DAY - 3600_000).toISOString() };
      }
    }
  }

  uuids(): string[] {
    return Object.keys(this.nodes);
  }

  status(): Record<string, unknown> {
    return {
      feature: "hostname",
      config: this.config,
      refresh: { ...this.refresh, max_concurrent_jobs: 4, result_timeout_seconds: 20, job_timeout_seconds: 30, failures: [] },
      entries: this.entries,
    };
  }

  /** Mimics plugin:onani.hostname.refresh: queue the targets and mark them active. */
  private startRefresh(params: Record<string, unknown>): Record<string, unknown> {
    const uuids = Array.isArray(params.uuids) ? params.uuids.map(String) : null;
    if (!uuids && this.refresh.bulk_running) {
      return { accepted: false, ...this.refresh, message: "批量刷新已在运行或排队中" };
    }
    const online = this.uuids().filter((uuid) => this.statuses[uuid]?.online === true);
    const targets = uuids ? uuids.filter((uuid) => online.includes(uuid)) : online.filter((uuid) => params.force === true || !this.entries[uuid]?.hostname);
    this.refresh = {
      running: true, reason: "manual", started_at: new Date().toISOString(), finished_at: null,
      requested: targets.length, targeted: targets.length, succeeded: 0, failed: 0,
      message: `正在刷新 ${targets.length} 个节点`, active_uuids: targets, queued_uuids: [], bulk_running: !uuids,
    };
    this.refreshPlan = targets.map((uuid) => ({ uuid, hostname: this.entries[uuid]?.hostname?.replace(/-old$/, "") || `host-${uuid.slice(0, 6)}` }));
    return { accepted: true, ...this.refresh, message: "刷新任务已加入队列" };
  }

  /** Completes every planned target (optionally failing some) and finishes the run. */
  finishRefresh(failures: Record<string, string> = {}): void {
    let succeeded = 0;
    let failed = 0;
    const at = new Date().toISOString();
    for (const step of this.refreshPlan) {
      if (failures[step.uuid]) {
        failed += 1;
        this.entries[step.uuid] = { ...this.entries[step.uuid], last_attempt_at: at, last_error: failures[step.uuid], last_failure: { stage: "Agent 执行 hostname", at, task_id: "task-finished", exit_code: 1, output: failures[step.uuid] } };
      } else {
        succeeded += 1;
        this.entries[step.uuid] = { hostname: step.hostname, collected_at: at, last_attempt_at: at };
      }
    }
    this.refreshPlan = [];
    this.refresh = {
      ...this.refresh, running: false, finished_at: at, succeeded, failed, active_uuids: [], queued_uuids: [], bulk_running: false,
      message: failed > 0 ? `刷新完成：成功 ${succeeded}，失败 ${failed}` : `刷新完成：成功 ${succeeded}`,
    };
  }

  handleRpc(body: Record<string, unknown>): Record<string, unknown> {
    const method = String(body.method);
    const params = (body.params ?? {}) as Record<string, unknown>;
    this.calls.push({ method, params: body.params });
    const failure = this.failMethods.get(method);
    if (failure) return { jsonrpc: "2.0", id: body.id, error: failure };
    let result: unknown;
    switch (method) {
      case "common:getNodes": result = this.nodes; break;
      case "common:getNodesLatestStatus": result = this.statuses; break;
      case "plugin:onani.hostname.status": result = this.status(); break;
      case "plugin:onani.hostname.refresh": result = this.startRefresh(params); break;
      case "admin:listPlugins": result = [{ short: "onani", version: this.market.installedVersion }]; break;
      default: return { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "method not found" } };
    }
    return { jsonrpc: "2.0", id: body.id, result };
  }

  handleMarket(method: string, url: URL, body: Record<string, unknown> | null): { status: number; payload: unknown } {
    const ok = (data: unknown) => ({ status: 200, payload: { status: "success", data } });
    const route = url.pathname.replace("/api/admin/plugin/market", "");
    if (route === "/sources" && method === "GET") return ok(this.market.sources);
    if (route === "/sources" && method === "POST") {
      const source = { id: "onani-source", name: body?.name, url: body?.url, enabled: true };
      this.market.sources.push(source);
      return ok(source);
    }
    if (route.startsWith("/sources/") && method === "PUT") {
      const source = this.market.sources.find((item) => item.id === decodeURIComponent(route.slice(9)));
      if (source) Object.assign(source, body, { enabled: true });
      return ok(source);
    }
    if (route === "/catalog") {
      const source = this.market.sources.find((item) => item.url === UPDATE_SOURCE_URL);
      return ok({
        sources: [{ id: source?.id, count: 1 }],
        plugins: [{ short: "onani", version: this.market.latestVersion, source_id: source?.id, installable: true }],
      });
    }
    if (route === "/install" && method === "POST") {
      this.market.installs += 1;
      if (this.market.installError) return { status: 400, payload: { status: "error", message: this.market.installError } };
      this.market.installedVersion = this.market.latestVersion;
      return ok({ short: "onani", version: this.market.latestVersion });
    }
    return { status: 404, payload: { status: "error", message: "not found" } };
  }
}

export type HostOptions = { dark?: boolean; accent?: string };

function hostPage(options: HostOptions): string {
  return `<!doctype html>
<html lang="zh-CN" class="${options.dark ? "dark" : ""}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Komari Admin</title>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  body { background: #ffffff; color: #111; }
  html.dark body { background: rgb(10, 10, 10); color: #eee; }
  [data-accent-color="iris"] { --accent-9: #5b5bd6; --accent-10: #5151cd; --accent-11: #5753c6; --accent-contrast: #fff; }
  [data-accent-color="jade"] { --accent-9: #29a383; --accent-10: #26997b; --accent-11: #208368; --accent-contrast: #fff; }
  .dark [data-accent-color="iris"] { --accent-11: #b1a9ff; }
  .chrome { height: 56px; display: flex; align-items: center; padding: 0 24px; border-bottom: 1px solid rgb(128 128 128 / 20%); box-sizing: border-box; }
  .km-page-admin-plugin { padding: 20px 0; }
  iframe { display: block; width: 100%; height: calc(100vh - 96px); min-height: calc(100vh - 96px); border: 0; }
</style>
</head>
<body>
<div class="radix-themes" data-accent-color="${options.accent || "iris"}">
  <div class="chrome">Komari 管理后台</div>
  <main class="km-page-admin-plugin">
    <iframe id="plugin" title="onani/pages/index.html" src="${PAGE_PATH}" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"></iframe>
  </main>
</div>
</body>
</html>`;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

export type Harness = {
  origin: string;
  komari: FakeKomari;
  hostOptions: HostOptions;
  assetRequests: Array<{ path: string; cache: string | undefined }>;
  close(): Promise<void>;
};

export async function startHarness(komari = new FakeKomari()): Promise<Harness> {
  const hostOptions: HostOptions = {};
  const assetRequests: Array<{ path: string; cache: string | undefined }> = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const json = (status: number, payload: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(payload));
    };

    if (url.pathname === "/admin") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(hostPage(hostOptions));
      return;
    }
    if (url.pathname === "/api/rpc2" && request.method === "POST") {
      const body = JSON.parse(raw || "{}");
      const payload = komari.handleRpc(body);
      const delay = komari.methodDelays.get(String(body.method)) ?? 0;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      json(200, payload);
      return;
    }
    if (url.pathname.startsWith("/api/admin/plugin/market")) {
      const result = komari.handleMarket(request.method || "GET", url, raw ? JSON.parse(raw) : null);
      json(result.status, result.payload);
      return;
    }
    if (url.pathname.startsWith("/api/admin/plugin/onani/pages/")) {
      const name = url.pathname.slice("/api/admin/plugin/onani/pages/".length) || "index.html";
      const file = path.resolve(pagesDir, name);
      if (!file.startsWith(pagesDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        json(404, { error: "not found" });
        return;
      }
      assetRequests.push({ path: url.pathname, cache: request.headers["cache-control"] });
      response.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(fs.readFileSync(file));
      return;
    }
    json(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    komari,
    hostOptions,
    assetRequests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}
