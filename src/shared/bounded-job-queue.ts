export type JobQueueSnapshot = {
  active: number;
  pending: number;
  total: number;
};

type QueueListener = (snapshot: JobQueueSnapshot) => void;
type QueueErrorHandler<T> = (error: unknown, item: T) => void;

export class BoundedJobQueue<T> {
  private readonly pendingItems: T[] = [];
  private activeItems = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly worker: (item: T) => Promise<void>,
    private readonly onChange: QueueListener = () => undefined,
    private readonly onError: QueueErrorHandler<T> = () => undefined,
  ) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error("maxConcurrent must be a positive integer");
    }
  }

  get activeCount(): number {
    return this.activeItems;
  }

  get pendingCount(): number {
    return this.pendingItems.length;
  }

  get size(): number {
    return this.activeItems + this.pendingItems.length;
  }

  enqueue(item: T): void {
    this.pendingItems.push(item);
    this.pump();
  }

  snapshot(): JobQueueSnapshot {
    return {
      active: this.activeItems,
      pending: this.pendingItems.length,
      total: this.size,
    };
  }

  private pump(): void {
    let changed = false;
    while (this.activeItems < this.maxConcurrent && this.pendingItems.length > 0) {
      const item = this.pendingItems.shift();
      if (item === undefined) break;
      this.activeItems += 1;
      changed = true;
      void Promise.resolve()
        .then(() => this.worker(item))
        .catch((error: unknown) => this.onError(error, item))
        .finally(() => {
          this.activeItems -= 1;
          this.pump();
          this.emit();
        });
    }
    if (changed) this.emit();
  }

  private emit(): void {
    this.onChange(this.snapshot());
  }
}
