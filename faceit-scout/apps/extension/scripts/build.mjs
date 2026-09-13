import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { build, context } from "esbuild";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const isWatch = process.argv.includes("--watch");

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, shell: true, stdio: "inherit" });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
  });
}

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await copyFile(path.join(root, "manifest.source.json"), path.join(dist, "manifest.json"));
  await cp(path.join(root, "src", "popup", "index.html"), path.join(dist, "popup", "index.html"), { recursive: true });
  await cp(path.join(root, "src", "popup", "popup.css"), path.join(dist, "popup", "popup.css"), { recursive: true });
  const publicDirectory = path.join(root, "public");
  if (existsSync(publicDirectory)) {
    await cp(publicDirectory, dist, { recursive: true });
  }
}

await rm(dist, { recursive: true, force: true });
await copyStatic();
await run("npx", ["tsc", "--noEmit"]);

const options = {
  entryPoints: {
    "background/service-worker": path.join(root, "src/background/service-worker.ts"),
    "content/faceit-content": path.join(root, "src/content/faceit-content.ts"),
    "popup/popup": path.join(root, "src/popup/popup.ts"),
  },
  bundle: true,
  format: "iife",
  outdir: dist,
  platform: "browser",
  target: "chrome120",
};

if (isWatch) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log("Watching Chromium extension sources...");
  await new Promise(() => {});
} else {
  await build(options);
}
