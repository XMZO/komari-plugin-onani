export class OperationTimeoutError extends Error {
  readonly code = "ONANI_OPERATION_TIMEOUT";

  constructor(message: string) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new OperationTimeoutError(message));
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new OperationTimeoutError(message)));
    }, timeoutMs);

    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export function isOperationTimeout(error: unknown): error is OperationTimeoutError {
  return error instanceof OperationTimeoutError
    || (typeof error === "object" && error !== null && "code" in error
      && (error as { code?: unknown }).code === "ONANI_OPERATION_TIMEOUT");
}
