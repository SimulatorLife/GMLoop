import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPORT_DIRECTORY = process.env.GMLOOP_TEST_REPORT_DIR?.trim() || "reports";
const SHARD = process.env.GMLOOP_TEST_SHARD?.trim() || "";
const TEST_TIMEOUT_MS = 120_000;

const SUPPORTED_SHARDS = new Set([
  "workspace-1",
  "workspace-2",
  "workspace-3",
  "root-1",
  "root-2",
  "whole-project",
  "process-heavy",
]);

const WHOLE_PROJECT_TEST = "test/dist/3dspider-whole-project.integration.test.js";
const PROCESS_HEAVY_TEST = "test/dist/fixture-deep-cpu-worker.test.js";

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isPerformanceTest(relativePath) {
  const normalized = normalize(relativePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  return normalized.includes("/dist/test/performance/") || basename.includes("performance") || basename.includes("perf");
}

function isCandidateTest(relativePath) {
  const normalized = normalize(relativePath);
  if (!normalized.endsWith(".test.js") || isPerformanceTest(normalized)) return false;
  if (normalized.startsWith("src/") && normalized.includes("/dist/test/")) return true;
  return normalized.startsWith("test/dist/");
}

async function collectFiles(root) {
  const output = [];

  async function visit(currentDirectory) {
    let entries;
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      const absolute = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        output.push(normalize(path.relative(process.cwd(), absolute)));
      }
    }
  }

  await visit(root);
  return output;
}

function selectByModulo(files, index, total) {
  return files.filter((_, fileIndex) => fileIndex % total === index);
}

function selectShard(allTests) {
  const workspaceTests = allTests.filter((file) => file.startsWith("src/")).sort();
  const rootTests = allTests
    .filter((file) => file.startsWith("test/dist/") && file !== WHOLE_PROJECT_TEST && file !== PROCESS_HEAVY_TEST)
    .sort();

  switch (SHARD) {
    case "workspace-1":
      return selectByModulo(workspaceTests, 0, 3);
    case "workspace-2":
      return selectByModulo(workspaceTests, 1, 3);
    case "workspace-3":
      return selectByModulo(workspaceTests, 2, 3);
    case "root-1":
      return selectByModulo(rootTests, 0, 2);
    case "root-2":
      return selectByModulo(rootTests, 1, 2);
    case "whole-project":
      return allTests.includes(WHOLE_PROJECT_TEST) ? [WHOLE_PROJECT_TEST] : [];
    case "process-heavy":
      return allTests.includes(PROCESS_HEAVY_TEST) ? [PROCESS_HEAVY_TEST] : [];
    default:
      return [];
  }
}

function runTests(testFiles, reportPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "--disable-warning=ExperimentalWarning",
      "--test-force-exit",
      "--test",
      `--test-timeout=${TEST_TIMEOUT_MS}`,
      "--test-reporter=dot",
      "--test-reporter-destination=stdout",
      "--test-reporter=junit",
      `--test-reporter-destination=${reportPath}`,
      ...testFiles,
    ];

    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve({ status: 2, signal });
        return;
      }
      resolve({ status: code ?? 2, signal: null });
    });
  });
}

await mkdir(REPORT_DIRECTORY, { recursive: true });

const metadataPath = path.join(REPORT_DIRECTORY, `test-${SHARD || "unknown"}.json`);
const reportFile = `tests-${SHARD || "unknown"}.xml`;
const reportPath = path.join(REPORT_DIRECTORY, reportFile);
const startedAt = new Date();
const started = performance.now();

const metadata = {
  schemaVersion: 1,
  shard: SHARD,
  completed: false,
  status: 2,
  signal: null,
  durationMs: 0,
  testFileCount: 0,
  testFiles: [],
  reportFile,
  startedAt: startedAt.toISOString(),
  finishedAt: null,
};

try {
  if (!SUPPORTED_SHARDS.has(SHARD)) {
    throw new Error(`Unsupported GMLOOP_TEST_SHARD "${SHARD}".`);
  }

  const discovered = [
    ...(await collectFiles(path.join(process.cwd(), "src"))),
    ...(await collectFiles(path.join(process.cwd(), "test", "dist"))),
  ]
    .filter(isCandidateTest)
    .sort();

  const testFiles = selectShard(discovered);
  if (testFiles.length === 0) {
    throw new Error(`Test shard "${SHARD}" selected no compiled test files.`);
  }

  metadata.testFileCount = testFiles.length;
  metadata.testFiles = testFiles;

  const result = await runTests(testFiles, reportPath);
  metadata.status = result.status;
  metadata.signal = result.signal;
  metadata.completed = result.signal === null;
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  metadata.status = 2;
  metadata.completed = false;
} finally {
  metadata.durationMs = Math.round(performance.now() - started);
  metadata.finishedAt = new Date().toISOString();
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

process.exitCode = metadata.status;
