import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPOSITORY_URL = "https://github.com/XMZO/komari-plugin-onani";

type LocalizedText = string | Record<string, string>;

type PluginManifest = {
  name: LocalizedText;
  short: string;
  description?: LocalizedText;
  version: string;
  author: LocalizedText;
  url?: string;
  komari?: string;
};

export type UpdateCatalog = {
  schema: 1;
  plugins: Array<{
    name: LocalizedText;
    short: string;
    description?: LocalizedText;
    version: string;
    author: LocalizedText;
    url: string;
    download: string;
    sha256: string;
    komari?: string;
  }>;
};

function distDirectory(projectRoot: string): string {
  const root = path.resolve(projectRoot);
  const dist = path.resolve(root, "dist");
  if (path.dirname(dist) !== root || path.basename(dist) !== "dist") {
    throw new Error(`refusing to use unsafe dist directory: ${dist}`);
  }
  return dist;
}

export function cleanDist(projectRoot = PROJECT_ROOT): string {
  const dist = distDirectory(projectRoot);
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  return dist;
}

export function createUpdateCatalog(manifest: PluginManifest, sha256: string): UpdateCatalog {
  const digest = sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("release SHA-256 must contain 64 hexadecimal characters");
  if (manifest.short !== "onani") throw new Error(`unexpected plugin short: ${manifest.short}`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`invalid release version: ${manifest.version}`);
  }

  const assetName = `onani-${manifest.version}.zip`;
  return {
    schema: 1,
    plugins: [{
      name: manifest.name,
      short: manifest.short,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      url: manifest.url || REPOSITORY_URL,
      download: `${REPOSITORY_URL}/releases/download/v${manifest.version}/${assetName}`,
      sha256: digest,
      komari: manifest.komari,
    }],
  };
}

export function writeUpdateCatalog(projectRoot = PROJECT_ROOT): string {
  const root = path.resolve(projectRoot);
  const manifestPath = path.join(root, "komari-plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PluginManifest;
  const expectedTag = `v${manifest.version}`;
  const workflowTag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
  if (workflowTag && workflowTag !== expectedTag) {
    throw new Error(`release tag ${workflowTag} does not match manifest version ${expectedTag}`);
  }

  const dist = distDirectory(root);
  const archivePath = path.join(dist, `onani-${manifest.version}.zip`);
  if (!fs.existsSync(archivePath)) throw new Error(`release archive does not exist: ${archivePath}`);
  const digest = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  const catalog = createUpdateCatalog(manifest, digest);
  const outputPath = path.join(dist, "onani-update.json");
  fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  return outputPath;
}

function main(): void {
  const command = process.argv[2];
  if (command === "clean") {
    console.log(`Cleaned ${cleanDist()}`);
    return;
  }
  if (command === "metadata") {
    console.log(`Generated ${writeUpdateCatalog()}`);
    return;
  }
  throw new Error("usage: release-assets.ts <clean|metadata>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
