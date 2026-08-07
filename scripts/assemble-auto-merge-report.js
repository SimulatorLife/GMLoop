import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPORT_SCHEMA_VERSION = 2;
const REPORT_DIRECTORY = process.env.GMLOOP_REPORT_DIR?.trim() || "reports";
const EXPECTED_SHARDS = (process.env.GMLOOP_TEST_SHARDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const SYNTHETIC_JUNIT_MARKER = "Test runner exited with status ";

function parseInteger(value, fallback = 2) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

async function readJson(name) {
  try {
    return JSON.parse(await readFile(path.join(REPORT_DIRECTORY, name), "utf8"));
  } catch {
    return null;
  }
}

async function readText(name) {
  try {
    return await readFile(path.join(REPORT_DIRECTORY, name), "utf8");
  } catch {
    return "";
  }
}

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseAttributes(fragment) {
  const attributes = {};
  const pattern = /([A-Za-z_:][\w:.-]*)="([^"]*)"/gu;
  for (const match of fragment.matchAll(pattern)) {
    attributes[match[1]] = decodeXml(match[2]);
  }
  return attributes;
}

function parseJUnitDurations(xml, shard) {
  const output = [];
  const pattern = /<testcase\b([^>]*)>/gu;
  for (const match of xml.matchAll(pattern)) {
    const attributes = parseAttributes(match[1]);
    const durationSeconds = Number.parseFloat(attributes.time || attributes.duration || attributes.elapsed || "0");
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) continue;
    output.push({
      shard,
      name: attributes.name || "(unnamed test)",
      location: attributes.file || attributes.classname || "",
      durationSeconds,
    });
  }
  return output;
}

function escapeMarkdown(value) {
  return String(value || "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatDuration(seconds) {
  if (seconds >= 60) return `${(seconds / 60).toFixed(2)} min`;
  return `${seconds.toFixed(3)} s`;
}

await mkdir(REPORT_DIRECTORY, { recursive: true });

const lintMetadata = await readJson("lint-meta.json");
const lintStatus = parseInteger(lintMetadata?.status);
const buildStatus = parseInteger(process.env.GMLOOP_REPORT_BUILD_STATUS, 2);
const testShards = [];
const testCases = [];
let testReportSynthetic = false;

for (const shard of EXPECTED_SHARDS) {
  const shardMetadata = await readJson(`test-${shard}.json`);
  const reportFile = shardMetadata?.reportFile || `tests-${shard}.xml`;
  const junit = await readText(reportFile);
  const reportComplete = junit.includes("<testsuites") && junit.includes("</testsuites>");
  if (junit.includes(SYNTHETIC_JUNIT_MARKER)) testReportSynthetic = true;
  if (junit) testCases.push(...parseJUnitDurations(junit, shard));

  testShards.push({
    name: shard,
    completed: shardMetadata?.completed === true,
    status: Number.isInteger(shardMetadata?.status) ? shardMetadata.status : 2,
    signal: shardMetadata?.signal ?? null,
    durationMs: Number.isFinite(shardMetadata?.durationMs) ? shardMetadata.durationMs : 0,
    testFileCount: Number.isInteger(shardMetadata?.testFileCount) ? shardMetadata.testFileCount : 0,
    reportFile,
    reportComplete,
  });
}

const allShardStatusesComparable = testShards.every((shard) => shard.status === 0 || shard.status === 1);
const testStatus = allShardStatusesComparable
  ? Math.max(0, ...testShards.map((shard) => shard.status))
  : 2;
const completed =
  buildStatus === 0 &&
  lintMetadata?.completed === true &&
  (lintStatus === 0 || lintStatus === 1) &&
  testShards.length === EXPECTED_SHARDS.length &&
  testShards.every((shard) => shard.completed && shard.reportComplete && (shard.status === 0 || shard.status === 1));

const metadata = {
  schemaVersion: REPORT_SCHEMA_VERSION,
  completed,
  targetSha: process.env.GMLOOP_REPORT_TARGET_SHA?.trim() || "",
  toolingFingerprint: process.env.GMLOOP_REPORT_TOOL_FINGERPRINT?.trim() || "",
  buildStatus,
  lintStatus,
  testStatus,
  testReportSynthetic,
  testShards,
};

await writeFile(
  path.join(REPORT_DIRECTORY, "auto-merge-report.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8",
);

const sortedCases = [...testCases].sort((left, right) => right.durationSeconds - left.durationSeconds);
const timingJson = {
  generatedAt: new Date().toISOString(),
  targetSha: metadata.targetSha,
  shards: testShards.map((shard) => ({
    name: shard.name,
    durationMs: shard.durationMs,
    testFileCount: shard.testFileCount,
    status: shard.status,
  })),
  slowestTests: sortedCases.slice(0, 25),
};
await writeFile(
  path.join(REPORT_DIRECTORY, "test-durations.json"),
  `${JSON.stringify(timingJson, null, 2)}\n`,
  "utf8",
);

const markdown = [
  "### CI timing profile",
  "",
  "Full test validation runs on the synthetic merge and is split across independent runners. These timings are persisted on the PR so slow-test drift remains visible after short-lived Actions artifacts expire.",
  "",
  "#### Test shard wall time",
  "",
  "| Shard | Test files | Status | Wall time |",
  "| --- | ---: | ---: | ---: |",
  ...testShards
    .slice()
    .sort((left, right) => right.durationMs - left.durationMs)
    .map((shard) =>
      `| ${escapeMarkdown(shard.name)} | ${shard.testFileCount} | ${shard.status} | ${formatDuration(shard.durationMs / 1000)} |`,
    ),
  "",
  "#### Slowest test cases",
  "",
  "| Test | File / suite | Shard | Duration |",
  "| --- | --- | --- | ---: |",
  ...sortedCases.slice(0, 20).map((testCase) =>
    `| ${escapeMarkdown(testCase.name)} | ${escapeMarkdown(testCase.location)} | ${escapeMarkdown(testCase.shard)} | ${formatDuration(testCase.durationSeconds)} |`,
  ),
  "",
];

await writeFile(path.join(REPORT_DIRECTORY, "test-durations.md"), markdown.join("\n"), "utf8");

if (!completed) {
  console.error("Assembled auto-merge report is incomplete; validator will fail closed.");
}
