type FileSystem = {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void;
  readFileSync(path: string, encoding: string): string;
  writeFileSync(path: string, data: string, options?: { encoding?: string; mode?: number }): void;
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(path: string): void;
};

type PathModule = {
  join(...parts: string[]): string;
};

const fs = require("fs") as FileSystem;
const path = require("path") as PathModule;

export class JsonStore<T> {
  private readonly filePath: string;
  private readonly temporaryPath: string;

  constructor(
    directory: string,
    fileName: string,
    private readonly normalize: (value: unknown) => T,
  ) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.filePath = path.join(directory, fileName);
    this.temporaryPath = `${this.filePath}.tmp`;
  }

  read(): T {
    for (const candidate of [this.filePath, this.temporaryPath]) {
      if (!fs.existsSync(candidate)) continue;
      try {
        return this.normalize(JSON.parse(fs.readFileSync(candidate, "utf8")));
      } catch (error) {
        console.warn(`[onani] ignored invalid cache file: ${error instanceof Error ? error.message : "parse failed"}`);
      }
    }
    return this.normalize(undefined);
  }

  write(value: T): void {
    const serialized = `${JSON.stringify(value)}\n`;
    fs.writeFileSync(this.temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
    try {
      fs.renameSync(this.temporaryPath, this.filePath);
    } catch (firstError) {
      // Windows may not replace an existing file atomically. The cache is
      // reproducible, so fall back to a same-directory replace without ever
      // granting access outside the plugin storage root.
      try {
        if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
        fs.renameSync(this.temporaryPath, this.filePath);
      } catch {
        try {
          if (fs.existsSync(this.temporaryPath)) fs.unlinkSync(this.temporaryPath);
        } catch {
          // Preserve the original write error below.
        }
        throw firstError;
      }
    }
  }
}
