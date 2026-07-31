import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = path.join(root, "packages", "faceit-scout-extension-firefox.zip");

await mkdir(path.dirname(archive), { recursive: true });
await rm(archive, { force: true });

await new Promise((resolve, reject) => {
  const child = spawn("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${path.join(root, "dist", "*")}' -DestinationPath '${archive}' -Force`,
  ], { cwd: root, stdio: "inherit" });
  child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Package failed with ${code}`)));
});
