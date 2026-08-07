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
const buildStatus = await run("pnpm", ["run", "build:ts"]);
if (buildStatus !== 0) {
  process.exitCode = buildStatus;
} else {
  const [lintStatus, testStatus] = await Promise.all([
    run(process.execPath, [path.join(scriptDirectory, "lint-report.js")]),
    run("pnpm", ["run", "test:report:gate:compiled"]),
  ]);
  process.exitCode = testStatus || lintStatus;
}
