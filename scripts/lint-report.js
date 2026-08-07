import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const formatterPath =
  process.env.GMLOOP_ESLINT_CHECKSTYLE_FORMATTER?.trim() ||
  path.join(scriptDirectory, "eslint-checkstyle-formatter.js");

await mkdir("reports", { recursive: true });
const status = await run("pnpm", [
  "exec",
  "eslint",
  ".",
  "--format",
  formatterPath,
  "--output-file",
  "reports/eslint-checkstyle.xml",
]);
process.exitCode = status;
