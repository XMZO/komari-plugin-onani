type FileSystem = {
  existsSync(path: string): boolean;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
};

type PathModule = {
  join(...parts: string[]): string;
};

const fs = require("fs") as FileSystem;
const path = require("path") as PathModule;

const SAFE_ENTRY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// The persistent plugin directory survives upgrades, so data written by a removed
// feature would otherwise stay on disk forever. Only plain top-level names are
// accepted; nothing outside the plugin's own storage can be targeted.
export function removeRetiredStorage(entries: readonly string[]): string[] {
  const removed: string[] = [];
  for (const entry of entries) {
    if (!SAFE_ENTRY.test(entry) || entry.includes("..")) continue;
    const target = path.join(__storageDir__, entry);
    try {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(entry);
      console.log(`[onani] removed retired storage: ${entry}`);
    } catch (error) {
      console.warn(`[onani] failed to remove retired storage ${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return removed;
}
