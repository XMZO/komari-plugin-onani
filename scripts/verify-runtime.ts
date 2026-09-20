import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Opt-in integration check against a sibling Komari checkout. Its test harness uses
// an in-memory database and temporary plugin directories, never a running deployment.
const root = fileURLToPath(new URL("..", import.meta.url));
const komari = path.resolve(process.argv[2] || path.join(root, "..", "komari"));
const destination = path.join(komari, "internal", "plugin", "onani_background_integration_test.go");
fs.writeFileSync(destination, fs.readFileSync(path.join(root, "tests", "komari-runtime.go.txt")), { flag: "wx" });
try {
  execFileSync("go", ["test", "./internal/plugin", "-run", "^TestOnani(Background|Hostname)Runtime$", "-count=1", "-v"], {
    cwd: komari, env: { ...process.env, ONANI_PROJECT_ROOT: root }, stdio: "inherit", windowsHide: true,
  });
} finally { fs.unlinkSync(destination); }
