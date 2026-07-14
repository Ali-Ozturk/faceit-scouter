import { copyFile, cp, mkdir, rm } from "node:fs/promises";
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
  await copyFile(path.join(root, "manifest.json"), path.join(dist, "manifest.json"));
  await cp(path.join(root, "src", "popup", "index.html"), path.join(dist, "popup", "index.html"), { recursive: true });
  await cp(path.join(root, "src", "popup", "popup.css"), path.join(dist, "popup", "popup.css"), { recursive: true });
  await cp(path.join(root, "public"), dist, { recursive: true });
}

await rm(dist, { recursive: true, force: true });
await copyStatic();
await run("npx", [
  "tsc",
  "-p", "tsconfig.build.json",
  ...(isWatch ? ["--watch", "--preserveWatchOutput"] : []),
]);
