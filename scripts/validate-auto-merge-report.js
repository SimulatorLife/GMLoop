import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REPORT_SCHEMA_VERSION = 1;
const reportDirectory = process.env.GMLOOP_REPORT_DIR?.trim() || "reports";
const expectedSha = process.env.GMLOOP_REPORT_EXPECTED_SHA?.trim() || "";
const expectedFingerprint = process.env.GMLOOP_REPORT_EXPECTED_TOOL_FINGERPRINT?.trim() || "";
const errors = [];

async function readText(name) {
  try {
    return await readFile(path.join(reportDirectory, name), "utf8");
  } catch (error) {
    errors.push(`${name}: ${error?.code || error?.message || "unable to read"}`);
    return "";
  }
}

const metadataText = await readText("auto-merge-report.json");
let metadata = null;
if (metadataText) {
  try {
    metadata = JSON.parse(metadataText);
  } catch (error) {
    errors.push(`auto-merge-report.json: invalid JSON (${error.message})`);
  }
}

if (metadata) {
  if (metadata.schemaVersion !== REPORT_SCHEMA_VERSION) errors.push(`unsupported report schema ${metadata.schemaVersion}`);
  if (metadata.completed !== true) errors.push("report did not complete");
  if (expectedSha && metadata.targetSha !== expectedSha) errors.push(`target SHA mismatch (${metadata.targetSha || "missing"} != ${expectedSha})`);
  if (expectedFingerprint && metadata.toolingFingerprint !== expectedFingerprint) {
    errors.push("report tooling fingerprint does not match the current validation tooling");
  }
  if (metadata.buildStatus !== 0) errors.push(`build did not complete successfully (status ${metadata.buildStatus})`);
  if (!Number.isInteger(metadata.lintStatus) || metadata.lintStatus < 0 || metadata.lintStatus > 1) {
    errors.push(`lint execution did not produce a comparable result (status ${metadata.lintStatus})`);
  }
  if (!Number.isInteger(metadata.testStatus) || metadata.testStatus < 0) {
    errors.push(`test execution did not produce a comparable result (status ${metadata.testStatus})`);
  }
  if (metadata.testReportSynthetic === true) errors.push("JUnit report was synthesized after the test runner failed to produce a genuine report");
}

const junit = await readText("tests.xml");
if (junit && (!junit.includes("<testsuites") || !junit.includes("</testsuites>"))) {
  errors.push("tests.xml is incomplete");
}

const checkstyle = await readText("eslint-checkstyle.xml");
if (checkstyle && (!checkstyle.includes("<checkstyle") || !checkstyle.includes("</checkstyle>"))) {
  errors.push("eslint-checkstyle.xml is incomplete");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`Invalid auto-merge report: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated complete auto-merge report in ${reportDirectory}.`);
}
