import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const examplePath = fileURLToPath(new URL("../.env.example", import.meta.url));
let env = readFileSync(existsSync(envPath) ? envPath : examplePath, "utf8");
const existing = env.match(/^SCOUT_IMPORT_KEY=(.*)$/m);
if (!existing || existing[1].trim().replace(/^['"]|['"]$/g, "").length < 24) {
  const line = `SCOUT_IMPORT_KEY=${randomBytes(32).toString("hex")}`;
  env = existing ? env.replace(/^SCOUT_IMPORT_KEY=.*$/m, line) : env.trimEnd() + "\n" + line + "\n";
  writeFileSync(envPath, env);
  console.log("Created SCOUT_IMPORT_KEY in .env. Copy that value into the extension's Import access key field.");
} else {
  console.log("Existing SCOUT_IMPORT_KEY preserved. Use that value in the extension.");
}
