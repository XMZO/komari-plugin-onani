import { server } from "@komari-monitor/plugin-sdk";

import { JsonStore } from "../../shared/json-store";
import { BoundedJobQueue } from "../../shared/bounded-job-queue";
import { isOperationTimeout, OperationTimeoutError, withTimeout } from "../../shared/async-timeout";
import {
  emptyHostnameCache,
  isRecord,
  isUuid,
  normalizeHostname,
  normalizeHostnameCache,
  normalizeUuidList,
  resolveHostnameConfig,
  safeErrorText,
  shouldRefreshHostname,
  type HostnameCache,
  type HostnameCacheEntry,
  type HostnameConfig,
  type HostnameConfigInput,
} from "./core";

const STATUS_RPC = "plugin:onani.hostname.status";
const REFRESH_RPC = "plugin:onani.hostname.refresh";
const HOSTNAME_COMMAND = "hostname";
const AUTO_SCAN_EXPRESSION = "@every 6h";
const STARTUP_SCAN_DELAY_MS = 20_000;
const RESULT_POLL_INTERVAL_MS = 1_000;
const CONFIG_RPC_TIMEOUT_MS = 5_000;
const LOCAL_RPC_TIMEOUT_MS = 5_000;
const EXEC_RPC_TIMEOUT_MS = 7_000;
const RESULT_RPC_TIMEOUT_MS = 5_000;
const RESULT_POLL_TIMEOUT_MS = 20_000;
const REFRESH_JOB_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_REFRESH_JOBS = 4;
const RPC_NOT_FOUND = -32044;

type NodeInfo = {
  uuid?: string;
  name?: string;
  weight?: number;
};

type NodeStatus = {
  online?: boolean;
};

type ExecResponse = {
  task_id?: string;
  clients?: string[];
  queued_clients?: string[];
};

type TaskResult = {
  client?: string;
  result?: string;
  exit_code?: number | null;
};

type RefreshReason = "startup" | "scheduled" | "manual";

type RefreshRequest = {
  reason: RefreshReason;
  force: boolean;
  uuids?: string[];
};

type RefreshJob = {
  request: RefreshRequest;
  reservedUuids: Set<string>;
  activeUuids: Set<string>;
  bulk: boolean;
  deadlineAt: number;
};

type RefreshState = {
  running: boolean;
  reason: RefreshReason | null;
  started_at: string | null;
  finished_at: string | null;
  requested: number;
  targeted: number;
  succeeded: number;
  failed: number;
  skipped_offline: number;
  skipped_fresh: number;
  skipped_busy: number;
  message: string;
};

const DEFAULT_CONFIG = resolveHostnameConfig({});

function newRefreshState(): RefreshState {
  return {
    running: false,
    reason: null,
    started_at: null,
    finished_at: null,
    requested: 0,
    targeted: 0,
    succeeded: 0,
    failed: 0,
    skipped_offline: 0,
    skipped_fresh: 0,
    skipped_busy: 0,
    message: "尚未执行采集",
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nodeMapFrom(value: unknown): Map<string, NodeInfo> {
  const nodes = new Map<string, NodeInfo>();
  if (!isRecord(value)) return nodes;
  for (const [key, rawNode] of Object.entries(value)) {
    if (!isRecord(rawNode)) continue;
    const uuidCandidate = isUuid(rawNode.uuid) ? rawNode.uuid : key;
    if (!isUuid(uuidCandidate)) continue;
    nodes.set(uuidCandidate.toLowerCase(), {
      uuid: uuidCandidate.toLowerCase(),
      name: typeof rawNode.name === "string" ? rawNode.name : undefined,
      weight: typeof rawNode.weight === "number" ? rawNode.weight : undefined,
    });
  }
  return nodes;
}

function onlineSetFrom(value: unknown): Set<string> {
  const online = new Set<string>();
  if (!isRecord(value)) return online;
  for (const [uuid, rawStatus] of Object.entries(value)) {
    if (isUuid(uuid) && isRecord(rawStatus) && rawStatus.online === true) {
      online.add(uuid.toLowerCase());
    }
  }
  return online;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && isUuid(item)).map((item) => item.toLowerCase())
    : [];
}

function rpcErrorCode(error: unknown): number | null {
  if (!isRecord(error) || typeof error.code !== "number" || !Number.isInteger(error.code)) return null;
  return error.code;
}

class HostnameFeature {
  private readonly store = new JsonStore<HostnameCache>(
    __storageDir__,
    "hostname-cache.json",
    normalizeHostnameCache,
  );

  private cache: HostnameCache = emptyHostnameCache();
  private config: HostnameConfig = DEFAULT_CONFIG;
  private refresh = newRefreshState();
  private readonly queuedUuids = new Set<string>();
  private readonly activeUuids = new Set<string>();
  private bulkJobs = 0;
  private waveMessage: string | null = null;
  private waveError: string | null = null;
  private readonly jobs = new BoundedJobQueue<RefreshJob>(
    MAX_CONCURRENT_REFRESH_JOBS,
    (job) => this.processRefreshJob(job),
    () => this.syncRefreshState(),
    (error) => console.error(`[onani] hostname queue failed: ${safeErrorText(error)}`),
  );

  load(): void {
    this.cache = this.store.read();
    server.registerRPC(STATUS_RPC, () => this.status());
    server.registerRPC(REFRESH_RPC, (params: unknown) => this.requestManualRefresh(params));
    server.cron(AUTO_SCAN_EXPRESSION, () => this.requestRefresh({ reason: "scheduled", force: false }));

    void this.reloadConfig().catch((error) => {
      console.error(`[onani] failed to load hostname configuration: ${safeErrorText(error)}`);
    });
    setTimeout(() => {
      this.requestRefresh({ reason: "startup", force: false });
    }, STARTUP_SCAN_DELAY_MS);
  }

  private status(): Record<string, unknown> {
    return {
      feature: "hostname",
      cache_schema: this.cache.schema,
      cache_updated_at: this.cache.updated_at,
      config: {
        enabled: this.config.enabled,
        auto_refresh: this.config.autoRefresh,
        cache_days: this.config.cacheDays,
        scan_interval_hours: 6,
        failure_retry_hours: 24,
      },
      refresh: this.refreshSnapshot(),
      entries: { ...this.cache.entries },
    };
  }

  private requestManualRefresh(params: unknown): Record<string, unknown> {
    const input = isRecord(params) ? params : {};
    const suppliedUuids = Object.prototype.hasOwnProperty.call(input, "uuids");
    const uuids = normalizeUuidList(input.uuids);
    if (suppliedUuids && uuids.length === 0) {
      return this.refreshResponse(false, "没有有效的节点 UUID");
    }
    return this.requestRefresh({
      reason: "manual",
      force: input.force === true,
      uuids: suppliedUuids ? uuids : undefined,
    });
  }

  private requestRefresh(request: RefreshRequest): Record<string, unknown> {
    const bulk = request.uuids === undefined;
    if (bulk && this.bulkJobs > 0) {
      return this.refreshResponse(false, "批量刷新已在运行或排队中");
    }

    const requestedUuids = request.uuids ?? [];
    const availableUuids = requestedUuids.filter(
      (uuid) => !this.activeUuids.has(uuid) && !this.queuedUuids.has(uuid),
    );
    if (!bulk && availableUuids.length === 0) {
      return this.refreshResponse(false, "所选节点已在刷新或排队中");
    }

    if (!this.refresh.running && this.jobs.size === 0) {
      this.refresh = {
        ...newRefreshState(),
        running: true,
        reason: request.reason,
        started_at: new Date().toISOString(),
        message: "正在检查节点和缓存",
      };
      this.waveMessage = null;
      this.waveError = null;
    } else if (request.reason === "manual") {
      this.refresh.reason = "manual";
    }

    const reservedUuids = new Set(availableUuids);
    for (const uuid of reservedUuids) this.queuedUuids.add(uuid);
    if (bulk) this.bulkJobs += 1;

    const job: RefreshJob = {
      request: { ...request, uuids: bulk ? undefined : availableUuids },
      reservedUuids,
      activeUuids: new Set<string>(),
      bulk,
      deadlineAt: Date.now() + REFRESH_JOB_TIMEOUT_MS,
    };
    this.jobs.enqueue(job);
    this.syncRefreshState();

    const skipped = requestedUuids.length - availableUuids.length;
    const message = skipped > 0
      ? `刷新任务已加入队列，已跳过 ${skipped} 个重复节点`
      : "刷新任务已加入队列";
    return this.refreshResponse(true, message);
  }

  private refreshSnapshot(): Record<string, unknown> {
    return {
      ...this.refresh,
      active_uuids: [...this.activeUuids].sort(),
      queued_uuids: [...this.queuedUuids].sort(),
      active_jobs: this.jobs.activeCount,
      queued_jobs: this.jobs.pendingCount,
      bulk_running: this.bulkJobs > 0,
      max_concurrent_jobs: MAX_CONCURRENT_REFRESH_JOBS,
      result_timeout_seconds: RESULT_POLL_TIMEOUT_MS / 1000,
      job_timeout_seconds: REFRESH_JOB_TIMEOUT_MS / 1000,
    };
  }

  private refreshResponse(accepted: boolean, message: string): Record<string, unknown> {
    return { accepted, ...this.refreshSnapshot(), message };
  }

  private syncRefreshState(): void {
    const wasRunning = this.refresh.running;
    const running = this.jobs.size > 0;
    this.refresh.running = running;

    if (running) {
      const active = this.activeUuids.size;
      const queued = this.queuedUuids.size;
      if (active > 0 && queued > 0) {
        this.refresh.message = `正在刷新 ${active} 个节点，另有 ${queued} 个排队中`;
      } else if (active > 0) {
        this.refresh.message = `正在刷新 ${active} 个节点`;
      } else if (queued > 0) {
        this.refresh.message = `${queued} 个节点正在等待刷新`;
      } else {
        this.refresh.message = "正在检查节点和缓存";
      }
      return;
    }

    if (!wasRunning) return;
    this.refresh.finished_at = new Date().toISOString();
    if (this.refresh.targeted === 0 && this.waveError) {
      this.refresh.message = this.waveError;
    } else if (this.refresh.targeted === 0 && this.waveMessage) {
      this.refresh.message = this.waveMessage;
    } else {
      const summary = this.refresh.failed > 0
        ? `刷新完成：成功 ${this.refresh.succeeded}，失败 ${this.refresh.failed}`
        : `刷新完成：成功 ${this.refresh.succeeded}`;
      this.refresh.message = this.waveError ? `${summary}；${this.waveError}` : summary;
    }
  }

  private async processRefreshJob(job: RefreshJob): Promise<void> {
    try {
      await this.runRefresh(job);
    } catch (error) {
      const message = safeErrorText(error, "主机名刷新失败");
      this.waveError = message;
      const affected = [...new Set([...job.activeUuids, ...job.reservedUuids])];
      if (affected.length > 0) {
        this.markFailed(affected, message);
        this.persistCache();
      }
      console.error(`[onani] hostname refresh failed: ${message}`);
    } finally {
      for (const uuid of job.reservedUuids) this.queuedUuids.delete(uuid);
      for (const uuid of job.activeUuids) this.activeUuids.delete(uuid);
      job.activeUuids.clear();
      if (job.bulk) this.bulkJobs = Math.max(0, this.bulkJobs - 1);
      this.syncRefreshState();
    }
  }

  private callWithJobTimeout<T>(
    job: RefreshJob,
    operation: string,
    stageTimeoutMs: number,
    call: () => Promise<T>,
  ): Promise<T> {
    const remaining = job.deadlineAt - Date.now();
    if (remaining <= 0) {
      return Promise.reject(new OperationTimeoutError(
        `刷新作业超过 ${REFRESH_JOB_TIMEOUT_MS / 1000} 秒总时限，已自动取消`,
      ));
    }
    const timeoutMs = Math.min(stageTimeoutMs, remaining);
    const message = remaining <= stageTimeoutMs
      ? `刷新作业超过 ${REFRESH_JOB_TIMEOUT_MS / 1000} 秒总时限，已自动取消`
      : `${operation}超时（${stageTimeoutMs / 1000} 秒）`;
    return withTimeout(call(), timeoutMs, message);
  }

  private async reloadConfig(job?: RefreshJob): Promise<HostnameConfig> {
    const raw = job
      ? await this.callWithJobTimeout(
        job,
        "读取插件配置",
        CONFIG_RPC_TIMEOUT_MS,
        () => server.getConfig<HostnameConfigInput>(),
      )
      : await withTimeout(
        server.getConfig<HostnameConfigInput>(),
        CONFIG_RPC_TIMEOUT_MS,
        `读取插件配置超时（${CONFIG_RPC_TIMEOUT_MS / 1000} 秒）`,
      );
    this.config = resolveHostnameConfig(raw);
    return this.config;
  }

  private async runRefresh(job: RefreshJob): Promise<void> {
    const request = job.request;
    const config = await this.reloadConfig(job);
    if (!config.enabled) {
      this.waveMessage = "主机名采集功能已关闭";
      return;
    }
    if (request.reason !== "manual" && !config.autoRefresh) {
      this.waveMessage = "自动刷新已关闭";
      return;
    }

    const [rawNodes, rawStatuses] = await Promise.all([
      this.callWithJobTimeout(
        job,
        "读取节点列表",
        LOCAL_RPC_TIMEOUT_MS,
        () => server.call<Record<string, NodeInfo>>("common:getNodes"),
      ),
      this.callWithJobTimeout(
        job,
        "读取节点状态",
        LOCAL_RPC_TIMEOUT_MS,
        () => server.call<Record<string, NodeStatus>>("common:getNodesLatestStatus"),
      ),
    ]);
    const nodes = nodeMapFrom(rawNodes);
    const online = onlineSetFrom(rawStatuses);
    this.pruneDeletedNodes(new Set(nodes.keys()));

    const requested = request.uuids ?? [...nodes.keys()];
    this.refresh.requested += requested.length;
    const now = Date.now();
    const targets: string[] = [];

    for (const uuid of requested) {
      if (!nodes.has(uuid)) continue;
      const reservedByAnotherJob = this.queuedUuids.has(uuid) && !job.reservedUuids.has(uuid);
      if (this.activeUuids.has(uuid) || reservedByAnotherJob) {
        this.refresh.skipped_busy += 1;
        continue;
      }
      if (!online.has(uuid)) {
        this.refresh.skipped_offline += 1;
        continue;
      }
      if (!request.force && !shouldRefreshHostname(this.cache.entries[uuid], now, config.cacheTtlMs)) {
        this.refresh.skipped_fresh += 1;
        continue;
      }
      targets.push(uuid);
    }

    this.refresh.targeted += targets.length;
    for (const uuid of targets) {
      this.activeUuids.add(uuid);
      job.activeUuids.add(uuid);
    }
    for (const uuid of job.reservedUuids) this.queuedUuids.delete(uuid);
    job.reservedUuids.clear();
    this.syncRefreshState();

    if (targets.length === 0) {
      this.waveMessage = "没有需要刷新的在线节点";
      return;
    }

    const attemptedAt = new Date().toISOString();
    for (const uuid of targets) {
      const previous = this.cache.entries[uuid] ?? {};
      this.cache.entries[uuid] = { ...previous, last_attempt_at: attemptedAt, last_error: undefined };
    }
    this.persistCache();

    let execResponse: ExecResponse;
    try {
      execResponse = await this.callWithJobTimeout(
        job,
        "下发 hostname 命令",
        EXEC_RPC_TIMEOUT_MS,
        () => server.call<ExecResponse>("admin:exec", {
          command: HOSTNAME_COMMAND,
          clients: targets,
        }),
      );
    } catch (error) {
      const message = `无法下发固定 hostname 命令：${safeErrorText(error)}`;
      this.markFailed(targets, message);
      this.releaseActive(job, targets);
      this.persistCache();
      return;
    }

    const taskId = typeof execResponse.task_id === "string" ? execResponse.task_id : "";
    if (!taskId) {
      this.markFailed(targets, "Komari 未返回远程任务 ID");
      this.releaseActive(job, targets);
      this.persistCache();
      return;
    }

    const targetSet = new Set(targets);
    const accepted = new Set(
      [...stringList(execResponse.clients), ...stringList(execResponse.queued_clients)]
        .filter((uuid) => targetSet.has(uuid)),
    );
    const rejected = targets.filter((uuid) => !accepted.has(uuid));
    if (rejected.length > 0) {
      this.markFailed(rejected, "节点在命令下发前已离线");
      this.releaseActive(job, rejected);
    }
    await this.collectTaskResults(job, taskId, [...accepted]);
    this.persistCache();
  }

  private async collectTaskResults(job: RefreshJob, taskId: string, targets: string[]): Promise<void> {
    const pending = new Set(targets);
    const resultDeadline = Math.min(job.deadlineAt, Date.now() + RESULT_POLL_TIMEOUT_MS);
    let consecutiveErrors = 0;

    while (pending.size > 0 && Date.now() < resultDeadline) {
      let results: TaskResult[] = [];
      try {
        const remaining = resultDeadline - Date.now();
        const timeoutMs = Math.min(RESULT_RPC_TIMEOUT_MS, remaining);
        const deadlineMessage = job.deadlineAt <= resultDeadline
          ? `刷新作业超过 ${REFRESH_JOB_TIMEOUT_MS / 1000} 秒总时限，已自动取消`
          : `等待 Agent 返回主机名超时（${RESULT_POLL_TIMEOUT_MS / 1000} 秒）`;
        const message = remaining <= RESULT_RPC_TIMEOUT_MS
          ? deadlineMessage
          : `查询远程任务结果超时（${RESULT_RPC_TIMEOUT_MS / 1000} 秒）`;
        const response = await withTimeout(
          server.call<unknown>("admin:getTaskResultsByTaskId", { task_id: taskId }),
          timeoutMs,
          message,
        );
        if (Array.isArray(response)) results = response as TaskResult[];
        consecutiveErrors = 0;
      } catch (error) {
        if (isOperationTimeout(error)) throw error;
        if (rpcErrorCode(error) === RPC_NOT_FOUND) {
          consecutiveErrors = 0;
        } else {
          consecutiveErrors += 1;
          console.warn(`[onani] waiting for hostname task ${taskId}: ${safeErrorText(error)}`);
          if (consecutiveErrors >= 3) {
            throw new Error(`连续 3 次读取远程任务结果失败：${safeErrorText(error)}`);
          }
        }
      }

      let changed = false;
      for (const result of results) {
        const uuid = typeof result.client === "string" ? result.client.toLowerCase() : "";
        if (!pending.has(uuid) || typeof result.exit_code !== "number") continue;
        pending.delete(uuid);
        changed = true;
        if (result.exit_code === 0) {
          const normalized = normalizeHostname(result.result);
          if (normalized.ok) {
            const previous = this.cache.entries[uuid] ?? {};
            this.cache.entries[uuid] = {
              ...previous,
              hostname: normalized.hostname,
              collected_at: new Date().toISOString(),
              last_error: undefined,
            };
            this.refresh.succeeded += 1;
          } else {
            this.markFailed([uuid], normalized.error);
          }
        } else {
          this.markFailed([uuid], safeErrorText(result.result, `Agent 返回退出码 ${result.exit_code}`));
        }
        this.releaseActive(job, [uuid]);
      }
      if (changed) this.persistCache();
      const remaining = resultDeadline - Date.now();
      if (pending.size > 0 && remaining > 0) {
        await sleep(Math.min(RESULT_POLL_INTERVAL_MS, remaining));
      }
    }

    if (pending.size > 0) {
      const message = job.deadlineAt <= resultDeadline
        ? `刷新作业超过 ${REFRESH_JOB_TIMEOUT_MS / 1000} 秒总时限，已自动取消`
        : `等待 Agent 返回主机名超时（${RESULT_POLL_TIMEOUT_MS / 1000} 秒）`;
      this.markFailed([...pending], message);
      this.releaseActive(job, [...pending]);
    }
  }

  private releaseActive(job: RefreshJob, uuids: string[]): void {
    for (const uuid of uuids) {
      job.activeUuids.delete(uuid);
      this.activeUuids.delete(uuid);
    }
    this.syncRefreshState();
  }

  private markFailed(uuids: string[], message: string): void {
    const safeMessage = safeErrorText(message);
    for (const uuid of uuids) {
      const previous: HostnameCacheEntry = this.cache.entries[uuid] ?? {};
      this.cache.entries[uuid] = { ...previous, last_error: safeMessage };
      this.refresh.failed += 1;
    }
  }

  private pruneDeletedNodes(currentUuids: Set<string>): void {
    let changed = false;
    for (const uuid of Object.keys(this.cache.entries)) {
      if (currentUuids.has(uuid)) continue;
      delete this.cache.entries[uuid];
      changed = true;
    }
    if (changed) this.persistCache();
  }

  private persistCache(): void {
    this.cache.updated_at = new Date().toISOString();
    this.store.write(this.cache);
  }
}

export function registerHostnameFeature(): void {
  new HostnameFeature().load();
}
