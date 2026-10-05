import { server } from "@komari-monitor/plugin-sdk";

import { LEGACY_TASK_RESULT_MATCHER, rewriteLegacyTaskResult } from "./core";

const WARNING_INTERVAL_MS = 60_000;

type HookRequest = {
  url?: unknown;
  body?: unknown;
  headers?: Record<string, unknown>;
};

class AgentCompatFeature {
  private lastWarningAt = 0;
  private suppressedWarnings = 0;

  load(): void {
    // Komari reads url/body/headers back synchronously after the hook returns.
    server.hook("request", LEGACY_TASK_RESULT_MATCHER, (req: HookRequest) => this.rewrite(req));
  }

  private rewrite(req: HookRequest): void {
    const rewrite = rewriteLegacyTaskResult(
      typeof req.url === "string" ? req.url : "",
      typeof req.body === "string" ? req.body : "",
    );
    if (!rewrite.ok) {
      // Unchanged requests still reach Komari and get its normal 404.
      this.warn(rewrite.reason);
      return;
    }
    req.url = rewrite.url;
    req.body = rewrite.body;
    // The new body is plain JSON; stale encoding/length headers must not describe it.
    const headers = { ...(req.headers ?? {}) };
    delete headers["content-encoding"];
    delete headers["content-length"];
    headers["content-type"] = "application/json";
    req.headers = headers;
  }

  // The legacy path is reachable without a token, so keep junk requests from flooding the log.
  private warn(reason: string): void {
    const now = Date.now();
    if (now - this.lastWarningAt < WARNING_INTERVAL_MS) {
      this.suppressedWarnings += 1;
      return;
    }
    const suppressed = this.suppressedWarnings > 0 ? `；此前 60 秒内另有 ${this.suppressedWarnings} 次已省略` : "";
    this.lastWarningAt = now;
    this.suppressedWarnings = 0;
    console.warn(`[onani] 旧版 Agent 任务回传未转换：${reason}${suppressed}`);
  }
}

export function registerAgentCompatFeature(): void {
  new AgentCompatFeature().load();
}
