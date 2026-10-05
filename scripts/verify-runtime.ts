import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// Released Komari builds decode the embedded theme at init and require index.html, so
// build a one-file tar.zst. Older Node without zstd falls back to an empty file, which
// only newer Komari sources (lazy extraction) accept.
function minimalThemeArchive(): Buffer {
  const compress = (zlib as { zstdCompressSync?: (data: Buffer) => Buffer }).zstdCompressSync;
  if (!compress) return Buffer.alloc(0);
  const content = Buffer.from("<!doctype html><title>Komari</title>");
  const header = Buffer.alloc(512);
  header.write("index.html", 0);
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.fill(" ", 148, 156);
  header.write("0", 156);
  header.write("ustar\u000000", 257);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return compress(Buffer.concat([header, content, padding, Buffer.alloc(1024)]));
}

// Opt-in integration check against a sibling Komari checkout. Its test harness uses
// an in-memory database and temporary plugin directories, never a running deployment.
const root = fileURLToPath(new URL("..", import.meta.url));
const komari = path.resolve(process.argv[2] || path.join(root, "..", "komari"));
const destination = path.join(komari, "internal", "plugin", "onani_background_integration_test.go");
// The agent-compat test links Komari's real agent auth and v2 handler, which embed the
// built default theme. Source checkouts lack it (git-ignored), so add minimal placeholders.
const placeholders = ([
  ["web/public/defaultTheme/komari-theme.json", Buffer.from("{}")],
  ["web/public/defaultTheme/dist.tar.zst", minimalThemeArchive()],
] as const).map(([file, content]) => [path.join(komari, file), content] as const).filter(([file]) => !fs.existsSync(file));
// web/public's init creates ./data/theme relative to the test package directory.
const packageData = path.join(komari, "internal", "plugin", "data");
const createdPackageData = !fs.existsSync(packageData);
fs.writeFileSync(destination, fs.readFileSync(path.join(root, "tests", "komari-runtime.go.txt")), { flag: "wx" });
try {
  for (const [file, content] of placeholders) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { flag: "wx" });
  }
  execFileSync("go", ["test", "./internal/plugin", "-run", "^TestOnani(Background|Hostname|AgentCompat)Runtime$", "-count=1", "-v"], {
    cwd: komari, env: { ...process.env, ONANI_PROJECT_ROOT: root }, stdio: "inherit", windowsHide: true,
  });
} finally {
  fs.unlinkSync(destination);
  for (const [file] of placeholders) fs.rmSync(file, { force: true });
  if (createdPackageData) fs.rmSync(packageData, { recursive: true, force: true });
}
