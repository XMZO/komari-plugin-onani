import { server, type PluginRequest, type PluginResponse } from "@komari-monitor/plugin-sdk";
import { withTimeout } from "../../shared/async-timeout";
import { BACKGROUND_PATH, originalPath, parseMetadata, parseOriginalPath, resolveBackgroundConfig, type BackgroundConfig, type ImageMetadata } from "./core";

const fs = require("fs") as typeof import("node:fs");
const path = require("path") as typeof import("node:path");
const runtimeProcess = require("process") as typeof import("node:process");
const childProcess = require("child_process") as typeof import("node:child_process");
const JOB_TIMEOUT = 30_000;

class BackgroundFeature {
  private readonly cacheRoot = path.join(__storageDir__, "background-cache");
  private pending: { key: string; promise: Promise<ImageMetadata> } | null = null;
  private nextJobAt = 0;
  private lastError: string | null = null;
  private latest: ImageMetadata | null = null;

  load(): void {
    server.route("GET", BACKGROUND_PATH, (req, res) => this.handle(req, res, false));
    server.route("GET", `${BACKGROUND_PATH}/:id/original`, (req, res) => this.handle(req, res, true));
    server.registerRPC("plugin:onani.background.status", async () => ({
      config: await this.config(), endpoint: BACKGROUND_PATH, running: Boolean(this.pending),
      last_error: this.lastError, latest: this.latest,
    }));
  }

  private async config(): Promise<BackgroundConfig> {
    const raw = await withTimeout(server.getConfig(), 3_000, "读取背景代理配置超时");
    // Disabling works even if a previously saved source becomes invalid.
    if (raw.background_enabled !== true) return resolveBackgroundConfig({});
    return resolveBackgroundConfig(raw);
  }

  private prepare(config: BackgroundConfig): Promise<ImageMetadata> {
    const key = JSON.stringify(config);
    if (this.pending) {
      if (this.pending.key !== key) throw new Error("背景配置已更新，请稍后重试");
      return this.pending.promise;
    }
    if (Date.now() < this.nextJobAt) throw new Error("背景请求频繁，请稍后重试");
    this.nextJobAt = Date.now() + 2_000;
    const promise = this.runHelper(config).then((metadata) => {
      this.latest = metadata;
      this.lastError = null;
      return metadata;
    }).catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`[onani] background job failed: ${this.lastError}`);
      throw error;
    }).finally(() => { this.pending = null; });
    this.pending = { key, promise };
    return promise;
  }

  private runHelper(config: BackgroundConfig): Promise<ImageMetadata> {
    const os = runtimeProcess.platform === "win32" ? "windows" : runtimeProcess.platform;
    const arch = runtimeProcess.arch === "x64" ? "amd64" : runtimeProcess.arch;
    if (!["linux", "windows", "darwin"].includes(os) || !["amd64", "arm64"].includes(arch)) {
      return Promise.reject(new Error("背景代理不支持当前服务器架构"));
    }
    const executable = path.join(runtimeProcess.cwd(), "bin", `onani-background-${os}-${arch}${os === "windows" ? ".exe" : ""}`);
    if (!fs.existsSync(executable)) return Promise.reject(new Error("插件安装包缺少当前架构的背景处理程序"));
    if (os !== "windows") fs.chmodSync(executable, 0o700);
    const args = ["-cache", this.cacheRoot, "-source", config.source, `-webp=${config.webp}`, "-quality", String(config.quality)];
    return new Promise((resolve, reject) => {
      childProcess.execFile(executable, args, { timeout: JOB_TIMEOUT, maxBuffer: 16_384, encoding: "utf8", windowsHide: true }, (error, stdout, stderr) => {
        if (error) { reject(new Error(`图片处理失败: ${stderr.trim().slice(0, 500) || error.message}`)); return; }
        try { resolve(parseMetadata(JSON.parse(stdout))); } catch (error) { reject(error); }
      });
    });
  }

  private async handle(req: PluginRequest, res: PluginResponse, download: boolean): Promise<void> {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const config = await this.config();
      if (!config.enabled) { this.error(res, 404, "背景代理未启用"); return; }
      let metadata: ImageMetadata;
      if (download) {
        const id = parseOriginalPath(req.url);
        if (!id) { this.error(res, 404, "图片不存在"); return; }
        try { metadata = parseMetadata(JSON.parse(fs.readFileSync(path.join(this.cacheRoot, id, "meta.json"), "utf8"))); }
        catch { this.error(res, 410, "当前背景原图已过期，请刷新页面重新加载背景"); return; }
        if (metadata.id !== id || metadata.expiresAt <= Date.now()) { this.error(res, 410, "当前背景原图已过期，请刷新页面重新加载背景"); return; }
      } else {
        metadata = await this.prepare(config);
        // Recheck after the asynchronous job so switching off stops in-flight previews too.
        if (!(await this.config()).enabled) { this.error(res, 404, "背景代理未启用"); return; }
      }
      if (res.isAborted()) return;
      let data: Buffer;
      try { data = fs.readFileSync(path.join(this.cacheRoot, metadata.id, download ? "original" : "preview")); }
      catch { this.error(res, 410, "当前背景缓存已过期，请刷新页面重新加载背景"); return; }
      res.setHeader("Content-Type", download ? metadata.originalMime : metadata.previewMime);
      res.setHeader("Content-Length", String(data.length));
      if (download) {
        res.setHeader("Content-Disposition", `attachment; filename="komari-background-${metadata.id.slice(0, 12)}.${metadata.extension}"`);
      } else {
        res.setHeader("X-Onani-Original", originalPath(metadata.id));
        res.setHeader("X-Onani-Preview", metadata.webp ? "webp" : "original");
      }
      res.statusCode = 200;
      res.write(data);
      res.end();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`[onani] background request failed: ${this.lastError}`);
      this.error(res, 503, "背景暂时无法加载，请稍后重试");
    }
  }

  private error(res: PluginResponse, status: number, message: string): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: message }));
  }
}

export function registerBackgroundFeature(): void { new BackgroundFeature().load(); }
