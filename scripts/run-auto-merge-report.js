import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const REPORT_SCHEMA_VERSION = 1;
const REPORT_DIRECTORY = "reports";
const METADATA_PATH = path.join(REPORT_DIRECTORY, "auto-merge-report.json");
const SYNTHETIC_JUNIT_MARKER = "Test runner exited with status ";

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

async function writeMetadata({ buildStatus, lintStatus = null, testStatus = null, testReportSynthetic = false }) {
  const metadata = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    completed: true,
    targetSha: process.env.GMLOOP_REPORT_TARGET_SHA?.trim() || "",
    toolingFingerprint: process.env.GMLOOP_REPORT_TOOL_FINGERPRINT?.trim() || "",
    buildStatus,
    lintStatus,
    testStatus,
    testReportSynthetic,
  };
  await writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

await mkdir(REPORT_DIRECTORY, { recursive: true });
await rm(METADATA_PATH, { force: true });

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const buildStatus = await run("pnpm", ["run", "build:ts"]);
if (buildStatus !== 0) {
  await writeMetadata({ buildStatus });
  process.exitCode = buildStatus;
} else {
  const [lintStatus, testStatus] = await Promise.all([
    run(process.execPath, [path.join(scriptDirectory, "lint-report.js")]),
    run("pnpm", ["run", "test:report:gate:compiled"]),
  ]);

  let testReportSynthetic = true;
  try {
    const junit = await readFile(path.join(REPORT_DIRECTORY, "tests.xml"), "utf8");
    testReportSynthetic = junit.includes(SYNTHETIC_JUNIT_MARKER);
  } catch {
    testReportSynthetic = true;
  }

  await writeMetadata({ buildStatus, lintStatus, testStatus, testReportSynthetic });
  process.exitCode = testStatus || lintStatus;
}
