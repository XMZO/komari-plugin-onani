import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const moduleInfo = (name: string) => JSON.parse(execFileSync("go", ["list", "-m", "-json", name], { cwd: path.join(root, "helper"), encoding: "utf8", windowsHide: true })) as { Dir: string };
const targets = [["linux", "amd64"], ["linux", "arm64"], ["windows", "amd64"], ["darwin", "arm64"], ["darwin", "amd64"]];
fs.mkdirSync(path.join(root, "bin"), { recursive: true });
const webpRoot = moduleInfo("github.com/gen2brain/webp").Dir;
const goRoot = execFileSync("go", ["env", "GOROOT"], { encoding: "utf8", windowsHide: true }).trim();
const notices = [["gen2brain/webp", path.join(webpRoot, "LICENSE")], ["libwebp", path.join(webpRoot, "lib", "LICENSE.libwebp")], ["Go runtime", path.join(goRoot, "LICENSE")]];
fs.writeFileSync(path.join(root, "bin", "THIRD_PARTY_NOTICES.txt"), notices.map(([name, file]) => `${name}\n${fs.readFileSync(file, "utf8")}\n`).join("\n"));
for (const [os, arch] of targets) {
  const filename = `onani-background-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
  execFileSync("go", ["build", "-trimpath", "-tags=nodynamic", "-ldflags=-s -w", "-o", path.join(root, "bin", filename), "."], {
    cwd: path.join(root, "helper"),
    env: { ...process.env, CGO_ENABLED: "0", GOOS: os, GOARCH: arch },
    stdio: "inherit",
    windowsHide: true,
  });
  console.log(`Built ${filename}`);
}
