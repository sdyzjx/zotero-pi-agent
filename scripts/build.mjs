// Build the Zotero plugin: bundle core + web UI with esbuild, copy static assets,
// and pack everything into build/zotero-pi-agent-<version>.xpi
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dev = process.argv.includes("--dev");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const content = path.join(root, "addon/content");

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "firefox115",
  charset: "utf8",
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  legalComments: "none",
  define: { __DEV__: JSON.stringify(dev) },
  logLevel: "warning",
};

await build({ ...common, entryPoints: [path.join(root, "src/core/index.ts")], outfile: path.join(content, "core.js") });
await build({
  ...common,
  entryPoints: {
    chat: path.join(root, "src/web/chat.tsx"),
    settings: path.join(root, "src/web/settings.tsx"),
  },
  outdir: content,
  jsx: "automatic",
  jsxImportSource: "preact",
});

// KaTeX stylesheet + fonts
const katexDist = path.join(root, "node_modules/katex/dist");
const vendor = path.join(content, "vendor/katex");
await rm(vendor, { recursive: true, force: true });
await mkdir(vendor, { recursive: true });
await cp(path.join(katexDist, "katex.min.css"), path.join(vendor, "katex.min.css"));
await cp(path.join(katexDist, "fonts"), path.join(vendor, "fonts"), {
  recursive: true,
  filter: (src) => !src.endsWith(".ttf") && !src.endsWith(".woff"),
});

// Mermaid (loaded lazily by the chat page)
await cp(path.join(root, "node_modules/mermaid/dist/mermaid.min.js"), path.join(content, "vendor/mermaid.min.js"));

// Stage + zip
const stage = path.join(root, "build/addon");
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(root, "addon"), stage, { recursive: true });
// Optional local API key from .env (git-ignored) → plugin default pref.
// The resulting XPI then contains the key: keep it to yourself.
let embeddedKey = false;
const envPath = path.join(root, ".env");
if (existsSync(envPath)) {
  const env = Object.fromEntries(
    (await readFile(envPath, "utf8"))
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
  );
  if (env.DEEPSEEK_API_KEY) {
    const prefsPath = path.join(stage, "prefs.js");
    const prefs = await readFile(prefsPath, "utf8");
    await writeFile(
      prefsPath,
      prefs.replace('pref("extensions.zoteropi.apiKey", "");', `pref("extensions.zoteropi.apiKey", ${JSON.stringify(env.DEEPSEEK_API_KEY)});`),
    );
    embeddedKey = true;
  }
}

const manifestPath = path.join(stage, "manifest.json");
const manifest = (await readFile(manifestPath, "utf8")).replace("__VERSION__", pkg.version);
await writeFile(manifestPath, manifest);

const xpi = path.join(root, `build/zotero-pi-agent-${pkg.version}.xpi`);
if (existsSync(xpi)) await rm(xpi);
execFileSync("zip", ["-qr", "-9", xpi, "."], { cwd: stage });
console.log(`Built ${path.relative(root, xpi)}${dev ? " (dev)" : ""}${embeddedKey ? " — contains your DeepSeek API key from .env, do not share" : ""}`);
