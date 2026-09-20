import { type BackgroundConfig, type ImageMetadata, parseMetadata } from "./core";

type PoolDependencies = {
  create(config: BackgroundConfig): Promise<ImageMetadata>;
  read(id: string): ImageMetadata | null;
  load(): unknown;
  save(value: unknown): void;
  error(error: unknown): void;
  now?: () => number;
};

// Serve ready images immediately; source fetch/encoding happens off the visitor's path.
// Configuration identity is persisted so a changed source or quality never serves the old pool.
export class BackgroundPool {
  private key = "";
  private ids: string[] = [];
  private lastId = "";
  private pending: { key: string; promise: Promise<ImageMetadata | null> } | null = null;
  private nextRefreshAt = 0;
  private readonly now: () => number;

  constructor(private readonly deps: PoolDependencies) { this.now = deps.now ?? Date.now; }

  private activate(config: BackgroundConfig): void {
    const key = JSON.stringify(config);
    if (key === this.key) return;
    this.key = key;
    this.ids = [];
    this.lastId = "";
    this.nextRefreshAt = 0;
    try {
      const saved = this.deps.load() as { key?: unknown; ids?: unknown } | null;
      if (saved?.key === key && Array.isArray(saved.ids)) {
        this.ids = [...new Set(saved.ids.filter((id): id is string => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)))].slice(-8);
      }
    } catch (error) { this.deps.error(error); }
  }

  private ready(): ImageMetadata[] {
    const result: ImageMetadata[] = [];
    this.ids = this.ids.filter((id) => {
      const image = this.deps.read(id);
      if (!image || image.expiresAt <= this.now() + 60_000) return false;
      result.push(image);
      return true;
    });
    return result;
  }

  async get(config: BackgroundConfig): Promise<ImageMetadata> {
    this.activate(config);
    const ready = this.ready();
    if (ready.length > 0) {
      const candidates = ready.length > 1 ? ready.filter((image) => image.id !== this.lastId) : ready;
      const image = candidates[Math.floor(Math.random() * candidates.length)];
      this.lastId = image.id;
      void this.refresh(config).catch(this.deps.error);
      return image;
    }
    const image = await this.refresh(config, true);
    if (!image) throw new Error("背景正在准备，请稍后重试");
    this.lastId = image.id;
    return image;
  }

  async warm(config: BackgroundConfig): Promise<void> {
    if (!config.enabled) return;
    this.activate(config);
    // Only bootstrap a small pool, never an endless source fetch loop.
    for (let attempt = 0; attempt < 3 && this.ready().length < 3; attempt++) {
      if (this.key !== JSON.stringify(config)) return;
      await this.refresh(config, true);
    }
  }

  private async refresh(config: BackgroundConfig, force = false): Promise<ImageMetadata | null> {
    const key = JSON.stringify(config);
    if (this.pending) {
      if (this.pending.key === key) return this.pending.promise;
      await this.pending.promise.catch(() => null);
      if (this.key !== key) return null;
      return this.refresh(config, force);
    }
    if (this.key !== key || (!force && this.now() < this.nextRefreshAt)) return null;
    this.nextRefreshAt = this.now() + 30_000;
    const promise = this.deps.create(config).then((raw) => {
      const image = parseMetadata(raw);
      if (this.key !== key) return null;
      this.ids = [...this.ids.filter((id) => id !== image.id), image.id].slice(-8);
      this.deps.save({ key, ids: this.ids });
      return image;
    }).finally(() => { this.pending = null; });
    this.pending = { key, promise };
    return promise;
  }

  get running(): boolean { return this.pending !== null; }
}
