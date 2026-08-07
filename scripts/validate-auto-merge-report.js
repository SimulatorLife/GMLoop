import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const reportDirectory = process.env.GMLOOP_REPORT_DIR?.trim() || "reports";
const expectedSha = process.env.GMLOOP_REPORT_EXPECTED_SHA?.trim() || "";
const expectedFingerprint = process.env.GMLOOP_REPORT_EXPECTED_TOOL_FINGERPRINT?.trim() || "";
const syntheticJUnitMarker = "Test runner exited with status ";
const errors = [];

async function readText(name) {
  try {
    return await readFile(path.join(reportDirectory, name), "utf8");
  } catch (error) {
    errors.push(`${name}: ${error?.code || error?.message || "unable to read"}`);
    return "";
  }
}

function isComparableStatus(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1;
}

function validateJUnit(name, junit) {
  if (!junit) return;
  if (!junit.includes("<testsuites") || !junit.includes("</testsuites>")) {
    errors.push(`${name} is incomplete`);
  }
  if (junit.includes(syntheticJUnitMarker)) {
    errors.push(`${name} contains synthesized fallback JUnit output`);
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
  if (metadata.schemaVersion !== 1 && metadata.schemaVersion !== 2) {
    errors.push(`unsupported report schema ${metadata.schemaVersion}`);
  }
  if (metadata.completed !== true) errors.push("report did not complete");
  if (expectedSha && metadata.targetSha !== expectedSha) {
    errors.push(`target SHA mismatch (${metadata.targetSha || "missing"} != ${expectedSha})`);
  }
  if (expectedFingerprint && metadata.toolingFingerprint !== expectedFingerprint) {
    errors.push("report tooling fingerprint does not match the current validation tooling");
  }
  if (metadata.buildStatus !== 0) errors.push(`build did not complete successfully (status ${metadata.buildStatus})`);
  if (!isComparableStatus(metadata.lintStatus)) {
    errors.push(`lint execution did not produce a comparable result (status ${metadata.lintStatus})`);
  }
  if (!isComparableStatus(metadata.testStatus)) {
    errors.push(`test execution did not produce a comparable result (status ${metadata.testStatus})`);
  }
  if (metadata.testReportSynthetic === true) {
    errors.push("JUnit report was synthesized after the test runner failed to produce a genuine report");
  }

  if (metadata.schemaVersion === 1) {
    validateJUnit("tests.xml", await readText("tests.xml"));
  }

  if (metadata.schemaVersion === 2) {
    if (!Array.isArray(metadata.testShards) || metadata.testShards.length === 0) {
      errors.push("sharded report does not declare any test shards");
    } else {
      const seen = new Set();
      const statuses = [];
      for (const shard of metadata.testShards) {
        const name = typeof shard?.name === "string" ? shard.name.trim() : "";
        if (!name) {
          errors.push("test shard is missing a name");
          continue;
        }
        if (seen.has(name)) errors.push(`duplicate test shard ${name}`);
        seen.add(name);
        if (shard.completed !== true) errors.push(`test shard ${name} did not complete`);
        if (!isComparableStatus(shard.status)) {
          errors.push(`test shard ${name} did not produce a comparable result (status ${shard.status})`);
        } else {
          statuses.push(shard.status);
        }
        const reportFile = typeof shard.reportFile === "string" ? shard.reportFile.trim() : "";
        if (!reportFile || path.basename(reportFile) !== reportFile) {
          errors.push(`test shard ${name} has an invalid report file path`);
          continue;
        }
        const junit = await readText(reportFile);
        validateJUnit(reportFile, junit);
        if (shard.reportComplete !== true) errors.push(`test shard ${name} metadata marks its report incomplete`);
      }
      if (statuses.length === metadata.testShards.length) {
        const expectedTestStatus = Math.max(0, ...statuses);
        if (metadata.testStatus !== expectedTestStatus) {
          errors.push(`aggregate test status mismatch (${metadata.testStatus} != ${expectedTestStatus})`);
        }
      }
    }
  }
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
