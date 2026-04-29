import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { isCommanderErrorLike } from "../src/cli-core/commander-error-utils.js";
import { isCliUsageError } from "../src/cli-core/errors.js";
import {
    createGenerateQualityReportCommand,
    detectRegressions,
    detectResolvedFailures,
    ensureResultsAvailability,
    readTestResults,
    reportRegressionSummary,
    runGenerateQualityReport
} from "../src/commands/generate-quality-report.js";

const xmlHeader = '<?xml version="1.0" encoding="utf-8"?>\n';

// These tests intentionally rely on assert.strictEqual-style comparisons because
// Node.js deprecated the legacy assert.equal API. Behaviour has been
// revalidated via `pnpm test src/cli/test/detect-test-regressions.test.js`.

function writeXml(dir, name, contents) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.xml`), xmlHeader + contents);
}

function writeJson(dir, name, value) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
}

function createMockCommand(options) {
    return {
        opts: () => options
    };
}

let workspace;

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "gml-regression-"));
});

afterEach(() => {
    if (workspace && fs.existsSync(workspace)) {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
    workspace = undefined;
});

void test("detects regressions when a previously passing test now fails", () => {
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="formats node" classname="test" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="formats node" classname="test">
          <failure message="boom" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });
    const regressions = detectRegressions(base, merged);

    assert.strictEqual(regressions.length, 1);
    assert.strictEqual(regressions[0].from, "passed");
    assert.strictEqual(regressions[0].to, "failed");
});

void test("does not treat failing tests without a base counterpart as regressions", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="existing">
        <testcase name="stays green" classname="test" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "suite",
        `<testsuites>
      <testsuite name="existing">
        <testcase name="stays green" classname="test" />
      </testsuite>
      <testcase name="new scenario fails" classname="test">
        <failure message="nope" />
      </testcase>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const head = readTestResults(["reports"], { workspace });
    const regressions = detectRegressions(base, head);

    assert.strictEqual(regressions.length, 0);
});

void test("matches existing failures by trimmed file/name identity when keys differ", () => {
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="base-suite">
        <testcase name="stable failing test" classname="suite" file=" src/foo.test.js ">
          <failure message="still broken" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <testsuite name="renamed-suite">
        <testcase name=" stable failing test " classname="suite" file="src/foo.test.js">
          <failure message="still broken" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });
    const regressions = detectRegressions(base, merged);

    assert.strictEqual(regressions.length, 0);
});

void test("parses top-level test cases that are not nested in a suite", () => {
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testcase name="top level" classname="root" />
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <testcase name="top level" classname="root">
        <failure message="whoops" />
      </testcase>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });
    const regressions = detectRegressions(base, merged);

    assert.strictEqual(regressions.length, 1);
    assert.strictEqual(regressions[0].detail?.displayName.includes("top level"), true);
});

void test("ignores checkstyle reports when scanning result directories", () => {
    const resultsDir = path.join(workspace, "reports");

    writeXml(
        resultsDir,
        "tests",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="real failure" classname="suite">
          <failure message="boom" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    writeXml(
        resultsDir,
        "eslint-checkstyle",
        `<checkstyle version="1.0">
      <file name="src/example.js">
        <error line="1" severity="error" message="nope" source="lint" />
      </file>
    </checkstyle>`
    );

    const head = readTestResults(["reports"], { workspace });

    assert.strictEqual(head.stats.total, 1);
    assert.strictEqual(head.stats.failed, 1);
    assert.strictEqual([...head.results.keys()][0], "sample :: suite :: real failure");
    assert.equal(
        head.notes.some((note) => note.includes("Ignoring checkstyle report reports/eslint-checkstyle.xml")),
        true
    );
});

void test("records a note when XML lacks test suites or cases", () => {
    const resultsDir = path.join(workspace, "reports");

    writeXml(
        resultsDir,
        "invalid",
        `<report>
      <message>No structured tests</message>
    </report>`
    );

    const result = readTestResults(["reports"], { workspace });

    assert.strictEqual(result.stats.total, 0);
    assert.ok(result.notes.some((note) => note.includes("does not contain any test suites or cases")));
});

void test("normalizes whitespace when describing regression candidates", () => {
    const headDir = path.join(workspace, "reports");

    writeXml(
        headDir,
        "suite",
        `<testsuites>
      <testsuite name=" outer ">
        <testsuite name=" inner ">
          <testcase name="  spaced name  " classname="  spaced class  " file="  /tmp/example  ">
            <failure message="boom" />
          </testcase>
        </testsuite>
      </testsuite>
    </testsuites>`
    );

    const head = readTestResults(["reports"], { workspace });
    const records = [...head.results.values()];

    assert.strictEqual(records.length, 1);
    const record = records[0];

    assert.strictEqual(record.key, "outer :: inner :: spaced class :: spaced name");
    assert.strictEqual(record.displayName, "outer :: inner :: spaced name [/tmp/example]");
});

void test("ensureResultsAvailability throws when base results are unavailable", () => {
    const base = { usedDir: null };
    const target = { usedDir: "./reports" };

    assert.throws(
        () => ensureResultsAvailability(base, target),
        (error) => {
            if (!isCliUsageError(error)) {
                return false;
            }
            assert.match(error.message, /Unable to locate base test results/i);
            return true;
        }
    );
});

void test("reportRegressionSummary returns failure details when regressions exist", () => {
    const summary = reportRegressionSummary(
        [
            {
                key: "suite :: test",
                from: "passed",
                to: "failed",
                detail: { displayName: "suite :: test" }
            }
        ],
        "PR head",
        { resolvedFailures: [] }
    );

    assert.strictEqual(summary.exitCode, 1);
    assert.deepEqual(summary.lines, [
        "New failing tests detected (compared to base using PR head):",
        "- suite :: test (passed -> failed)"
    ]);
});

void test("reportRegressionSummary returns success details when no regressions exist", () => {
    const summary = reportRegressionSummary([], "PR head");

    assert.strictEqual(summary.exitCode, 0);
    assert.deepEqual(summary.lines, ["No new failing tests compared to base using PR head."]);
});

void test("reportRegressionSummary clarifies when regressions offset resolved failures", () => {
    const summary = reportRegressionSummary(
        [
            {
                key: "suite :: new failure",
                from: "passed",
                to: "failed",
                detail: { displayName: "suite :: new failure" }
            }
        ],
        "PR head",
        {
            resolvedFailures: [
                {
                    key: "suite :: resolved failure",
                    from: "failed",
                    to: "passed",
                    detail: { displayName: "suite :: resolved failure" }
                }
            ]
        }
    );

    assert.strictEqual(summary.exitCode, 1);
    assert.deepEqual(summary.lines, [
        "New failing tests detected (compared to base using PR head):",
        "- suite :: new failure (passed -> failed)",
        "Note: 1 previously failing test is now passing or missing, so totals may appear unchanged."
    ]);
});

void test("detectResolvedFailures returns failures that now pass or are missing", () => {
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="existing failure" classname="test">
          <failure message="nope" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="existing failure" classname="test" />
        <testcase name="new failure" classname="test">
          <failure message="boom" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });

    const resolvedFailures = detectResolvedFailures(base, merged);
    const regressions = detectRegressions(base, merged);

    assert.strictEqual(resolvedFailures.length, 1);
    assert.strictEqual(resolvedFailures[0].key, "sample :: test :: existing failure");
    assert.strictEqual(resolvedFailures[0].to, "passed");

    assert.strictEqual(regressions.length, 0);
});

void test("detectRegressions accepts heterogeneous result containers", () => {
    const base = {
        results: {
            "suite :: test :: scenario": {
                key: "suite :: test :: scenario",
                status: "passed"
            }
        },
        stats: { total: 1, passed: 1, failed: 0, skipped: 0 }
    };

    const backing = new Map([
        [
            "suite :: test :: scenario",
            {
                key: "suite :: test :: scenario",
                status: "failed",
                displayName: "suite :: test :: scenario"
            }
        ]
    ]);

    const target = {
        results: {
            get(key) {
                return backing.get(key);
            },
            set(key, value) {
                backing.set(key, value);
                return this;
            },
            entries() {
                return backing.entries();
            },
            [Symbol.iterator]() {
                return backing[Symbol.iterator]();
            }
        },
        stats: { total: 1, passed: 0, failed: 1, skipped: 0 }
    };

    const regressions = detectRegressions(base, target);

    assert.equal(regressions.length, 1);
    assert.equal(regressions[0].from, "passed");
    assert.equal(regressions[0].to, "failed");
    assert.equal(regressions[0].detail?.displayName, "suite :: test :: scenario");
});

void test("does not treat a JUnit-undefined-wrapper renamed failure as a regression", () => {
    // Reproduces the scenario where node's JUnit reporter emits `<undefined>` instead of
    // `<testsuite>` for a test file that crashes the IPC deserializer. The malformed tag
    // is never closed, so all subsequent tests appear nested under it and get a different
    // suite-path prefix. Tests that were already failing in base must not be reported as
    // new regressions just because their key gained an extra suite-path prefix.
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    // Base: a cross-module test that is already failing
    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="Cross-module integration fixtures">
        <testcase name="runs integration case test-int-struct-literal" classname="test"
                  file="/repo/test/dist/cross-module-integration.test.js">
          <failure message="actual !== expected" />
        </testcase>
        <testcase name="runs integration case test-int-no-globalvar" classname="test"
                  file="/repo/test/dist/cross-module-integration.test.js" />
      </testsuite>
    </testsuites>`
    );

    // Merged: the same tests, but nested under a malformed <undefined> wrapper that the
    // node JUnit reporter emits when it encounters an IPC-deserialization error.
    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <undefined name="Hot reload patch metadata">
        <testsuite name="Cross-module integration fixtures">
          <testcase name="runs integration case test-int-struct-literal" classname="test"
                    file="/repo/test/dist/cross-module-integration.test.js">
            <failure message="actual !== expected" />
          </testcase>
          <testcase name="runs integration case test-int-no-globalvar" classname="test"
                    file="/repo/test/dist/cross-module-integration.test.js" />
        </testsuite>
      </undefined>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });
    const regressions = detectRegressions(base, merged);

    // The failure in the renamed test was already present in base; it must not be
    // counted as a new regression.
    assert.strictEqual(regressions.length, 0);
});

void test("still detects genuine new failures even when other tests were renamed by JUnit structure change", () => {
    // When a JUnit XML structure change renames existing tests, genuinely new failures
    // (tests that did not exist in base at all, or were passing before) must still be
    // reported as regressions.
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="Suite A">
        <testcase name="was passing" classname="test"
                  file="/repo/test/dist/suite-a.test.js" />
      </testsuite>
    </testsuites>`
    );

    // Merged: "was passing" is now renamed under a wrapper AND is now failing.
    // Because the base test was passing, this should be a regression.
    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <undefined name="Hot reload patch metadata">
        <testsuite name="Suite A">
          <testcase name="was passing" classname="test"
                    file="/repo/test/dist/suite-a.test.js">
            <failure message="now broken" />
          </testcase>
        </testsuite>
      </undefined>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });
    const regressions = detectRegressions(base, merged);

    // "was passing" was previously passing; the new failure is a genuine regression.
    assert.strictEqual(regressions.length, 1);
    assert.strictEqual(regressions[0].to, "failed");
});

void test("does not count a node runner file-level IPC crash as a regression when inner tests passed", () => {
    // When the node test runner encounters an IPC-deserialization error while processing
    // a test file, it emits a synthetic <testcase> whose `name` is the relative file path
    // (e.g. "src/cli/dist/test/foo.test.js"). If the file's actual inner tests all passed,
    // this file-level wrapper failure is a runner infrastructure artefact, not a code
    // regression.
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="Hot reload patch metadata">
        <testcase name="should include metadata" classname="test"
                  file="/repo/src/cli/dist/test/hot-reload-metadata.test.js" />
      </testsuite>
    </testsuites>`
    );

    // Merged: the inner test still passes, but the file-level wrapper (name == relative
    // file path) fails with a node test runner IPC error.
    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <undefined name="Hot reload patch metadata">
        <testcase name="should include metadata" classname="test"
                  file="/repo/src/cli/dist/test/hot-reload-metadata.test.js" />
      </undefined>
      <testcase name="src/cli/dist/test/hot-reload-metadata.test.js" classname="test"
                file="/repo/src/cli/dist/test/hot-reload-metadata.test.js">
        <failure message="Unable to deserialize cloned data due to invalid or unsupported version." />
      </testcase>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });
    const regressions = detectRegressions(base, merged);

    // The file-level crash is an infrastructure artefact; it must not count as a regression.
    assert.strictEqual(regressions.length, 0);
});

void test("does not count a file-level crash as a regression when no inner tests passed", () => {
    // Newly introduced failing tests are allowed, so even this file-level crash record
    // should not count as a regression when no matching base test exists.
    const baseDir = path.join(workspace, "base/reports");
    const mergeDir = path.join(workspace, "merge/reports");

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="some unrelated test" classname="test"
                  file="/repo/src/cli/dist/test/other.test.js" />
      </testsuite>
    </testsuites>`
    );

    // Merged: file-level crash with NO passing inner tests from that file.
    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="some unrelated test" classname="test"
                  file="/repo/src/cli/dist/test/other.test.js" />
      </testsuite>
      <testcase name="src/cli/dist/test/broken.test.js" classname="test"
                file="/repo/src/cli/dist/test/broken.test.js">
        <failure message="Cannot find module './missing.js'" />
      </testcase>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const merged = readTestResults(["merge/reports"], { workspace });
    const regressions = detectRegressions(base, merged);

    assert.strictEqual(regressions.length, 0);
});

void test("readTestResults prefers canonical tests.xml results over auxiliary XML reports for duplicate test keys", () => {
    const resultsDir = path.join(workspace, "reports");

    writeXml(
        resultsDir,
        "tests",
        `<testsuites>
      <testsuite name="root">
        <testcase name="shared test" classname="suite" file="/repo/src/refactor/dist/test/naming-convention-performance.test.js" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        resultsDir,
        "performance",
        `<testsuites>
      <testsuite name="root">
        <testcase name="shared test" classname="suite" file="/repo/src/refactor/dist/test/naming-convention-performance.test.js">
          <failure message="performance threshold exceeded" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    const head = readTestResults(["reports"], { workspace });
    const record = head.results.get("root :: suite :: shared test");

    assert.ok(record);
    assert.strictEqual(record.status, "passed");
    assert.strictEqual(head.stats.total, 1);
    assert.strictEqual(head.stats.passed, 1);
    assert.strictEqual(head.stats.failed, 0);
    assert.strictEqual(head.stats.skipped, 0);
});

void test("readTestResults counts deduplicated records when canonical report replaces auxiliary failure", () => {
    const resultsDir = path.join(workspace, "reports");

    writeXml(
        resultsDir,
        "performance",
        `<testsuites>
      <testsuite name="root">
        <testcase name="shared test" classname="suite" file="/repo/src/refactor/dist/test/naming-convention-performance.test.js">
          <failure message="performance threshold exceeded" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    writeXml(
        resultsDir,
        "tests",
        `<testsuites>
      <testsuite name="root">
        <testcase name="shared test" classname="suite" file="/repo/src/refactor/dist/test/naming-convention-performance.test.js" />
      </testsuite>
    </testsuites>`
    );

    const head = readTestResults(["reports"], { workspace });

    assert.strictEqual(head.results.size, 1);
    assert.strictEqual(head.stats.total, 1);
    assert.strictEqual(head.stats.passed, 1);
    assert.strictEqual(head.stats.failed, 0);
    assert.strictEqual(head.stats.skipped, 0);
});

void test("readTestResults removes auxiliary wrapper-drift duplicates when canonical tests.xml has the logical test", () => {
    const resultsDir = path.join(workspace, "reports");

    writeXml(
        resultsDir,
        "tests",
        `<testsuites>
      <testsuite name="root">
        <testcase name="stable test" classname="suite" file="/repo/src/cli/dist/test/stable.test.js" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        resultsDir,
        "performance",
        `<testsuites>
      <undefined name="wrapper drift">
        <testsuite name="root">
          <testcase name="stable test" classname="suite" file="/repo/src/cli/dist/test/stable.test.js">
            <failure message="transient worker failure" />
          </testcase>
        </testsuite>
      </undefined>
    </testsuites>`
    );

    const head = readTestResults(["reports"], { workspace });

    assert.strictEqual(head.results.size, 1);
    assert.strictEqual(head.stats.total, 1);
    assert.strictEqual(head.stats.passed, 1);
    assert.strictEqual(head.stats.failed, 0);
    assert.strictEqual([...head.results.keys()][0], "root :: suite :: stable test");
});

void test("does not report regressions when only auxiliary performance.xml differs for the same test key", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "reports");

    writeXml(
        baseDir,
        "tests",
        `<testsuites>
      <testsuite name="root">
        <testcase name="shared test" classname="suite" file="/repo/src/refactor/dist/test/naming-convention-performance.test.js" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "tests",
        `<testsuites>
      <testsuite name="root">
        <testcase name="shared test" classname="suite" file="/repo/src/refactor/dist/test/naming-convention-performance.test.js" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "performance",
        `<testsuites>
      <testsuite name="root">
        <testcase name="shared test" classname="suite" file="/repo/src/refactor/dist/test/naming-convention-performance.test.js">
          <failure message="performance threshold exceeded" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const head = readTestResults(["reports"], { workspace });
    const regressions = detectRegressions(base, head);

    assert.strictEqual(regressions.length, 0);
});

void test("does not report regressions from auxiliary renamed failures when canonical tests.xml is passing", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "reports");

    writeXml(
        baseDir,
        "tests",
        `<testsuites>
      <testsuite name="root">
        <testcase name="stable test" classname="suite" file="/repo/src/cli/dist/test/stable.test.js" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "tests",
        `<testsuites>
      <testsuite name="root">
        <testcase name="stable test" classname="suite" file="/repo/src/cli/dist/test/stable.test.js" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "performance",
        `<testsuites>
      <undefined name="wrapper drift">
        <testsuite name="root">
          <testcase name="stable test" classname="suite" file="/repo/src/cli/dist/test/stable.test.js">
            <failure message="transient worker failure" />
          </testcase>
        </testsuite>
      </undefined>
    </testsuites>`
    );

    const base = readTestResults(["base/reports"], { workspace });
    const head = readTestResults(["reports"], { workspace });
    const regressions = detectRegressions(base, head);

    assert.strictEqual(regressions.length, 0);
});

void test("readTestResults preserves project health stats when present", () => {
    const resultsDir = path.join(workspace, "reports");

    writeXml(
        resultsDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="stays green" classname="test" />
      </testsuite>
    </testsuites>`
    );

    const health = {
        buildSize: "4.43 MB",
        largeFiles: 24,
        todos: 14
    };

    writeJson(resultsDir, "project-health.json", health);

    const result = readTestResults(["reports"], { workspace });

    assert.deepStrictEqual(result.health, health);
});

void test("quality report does not count head-only performance report cases as newly added PR tests", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "head/reports");
    const mergeDir = path.join(workspace, "merge/reports");
    const reportFile = path.join(workspace, "reports/summary-report.md");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });

    const stableSuite = `<testsuites>
      <testsuite name="sample">
        <testcase name="stable test" classname="suite" file="/repo/src/cli/dist/test/stable.test.js" />
      </testsuite>
    </testsuites>`;

    writeXml(baseDir, "tests", stableSuite);
    writeXml(headDir, "tests", stableSuite);
    writeXml(
        headDir,
        "performance",
        `<testsuites>
      <testsuite name="performance">
        <testcase name="head-only perf gate" classname="suite" file="/repo/src/cli/dist/test/perf-gate.test.js" />
      </testsuite>
    </testsuites>`
    );
    writeXml(mergeDir, "tests", stableSuite);

    const exitCode = runGenerateQualityReport({
        command: createMockCommand({
            base: baseDir,
            head: headDir,
            merge: mergeDir,
            reportFile
        })
    });

    assert.strictEqual(exitCode, 0);
    const markdown = fs.readFileSync(reportFile, "utf8");
    assert.match(markdown, /\| PR \(Head\) \| 2 \| 2 \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \| 0 \|/u);
});

void test("quality report explains merged snapshot gate semantics when merge artifacts are present", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "head/reports");
    const mergeDir = path.join(workspace, "merge/reports");
    const reportFile = path.join(workspace, "reports/summary-report.md");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="stable test" classname="suite" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="stable test" classname="suite" />
        <testcase name="new passing test" classname="suite" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="stable test" classname="suite" />
      </testsuite>
    </testsuites>`
    );

    const exitCode = runGenerateQualityReport({
        command: createMockCommand({
            base: baseDir,
            head: headDir,
            merge: mergeDir,
            reportFile
        })
    });

    assert.strictEqual(exitCode, 0);
    const markdown = fs.readFileSync(reportFile, "utf8");
    assert.match(markdown, /#### Regression Comparison Flow/u);
    assert.match(markdown, /Regression gate target: \*\*Merged\*\*\./u);
    assert.match(markdown, /✅ No test regressions detected \(Base → Merged\)\./u);
});

void test("quality report falls back to PR head gate semantics when merge artifacts are missing", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "head/reports");
    const reportFile = path.join(workspace, "reports/summary-report.md");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="stable test" classname="suite" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="stable test" classname="suite">
          <failure message="regression" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    const exitCode = runGenerateQualityReport({
        command: createMockCommand({
            base: baseDir,
            head: headDir,
            merge: path.join(workspace, "missing-merge/reports"),
            reportFile
        })
    });

    assert.strictEqual(exitCode, 10);
    const markdown = fs.readFileSync(reportFile, "utf8");
    assert.match(markdown, /Regression gate target: \*\*PR \(Head\)\*\*\./u);
    assert.match(markdown, /❌ Test regressions detected \(Base → PR \(Head\)\)\./u);
});

void test("quality report can compare when base only has a synthetic build failure", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "head/reports");
    const mergeDir = path.join(workspace, "merge/reports");
    const reportFile = path.join(workspace, "reports/summary-report.md");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });

    writeXml(
        baseDir,
        "build",
        `<testsuites>
      <testsuite name="build">
        <testcase name="pnpm run build:ts" classname="quality.build">
          <failure message="TypeScript workspace build failed" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "build",
        `<testsuites>
      <testsuite name="build">
        <testcase name="pnpm run build:ts" classname="quality.build" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "build",
        `<testsuites>
      <testsuite name="build">
        <testcase name="pnpm run build:ts" classname="quality.build" />
      </testsuite>
    </testsuites>`
    );

    const exitCode = runGenerateQualityReport({
        command: createMockCommand({
            base: baseDir,
            head: headDir,
            merge: mergeDir,
            reportFile
        })
    });

    assert.strictEqual(exitCode, 0);
    const markdown = fs.readFileSync(reportFile, "utf8");
    assert.match(markdown, /\| Base \| 1 \| 0 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \|/u);
    assert.match(markdown, /✅ No test regressions detected \(Base → Merged\)\./u);
});

void test("quality report separates pre-existing and new failures in target rows", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "head/reports");
    const mergeDir = path.join(workspace, "merge/reports");
    const reportFile = path.join(workspace, "reports/summary-report.md");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });

    writeXml(
        baseDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="existing failure" classname="suite" file="/repo/test/dist/example.test.js">
          <failure message="already failing" />
        </testcase>
        <testcase name="stable pass" classname="suite" file="/repo/test/dist/stable.test.js" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="existing failure" classname="suite" file="/repo/test/dist/example.test.js">
          <failure message="already failing" />
        </testcase>
        <testcase name="stable pass" classname="suite" file="/repo/test/dist/stable.test.js" />
        <testcase name="new regression" classname="suite" file="/repo/test/dist/stable.test.js">
          <failure message="regression" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "suite",
        `<testsuites>
      <testsuite name="sample">
        <testcase name="existing failure" classname="suite" file="/repo/test/dist/example.test.js">
          <failure message="already failing" />
        </testcase>
        <testcase name="stable pass" classname="suite" file="/repo/test/dist/stable.test.js" />
      </testsuite>
    </testsuites>`
    );

    const exitCode = runGenerateQualityReport({
        command: createMockCommand({
            base: baseDir,
            head: headDir,
            merge: mergeDir,
            reportFile
        })
    });

    assert.strictEqual(exitCode, 0);
    const markdown = fs.readFileSync(reportFile, "utf8");
    assert.match(markdown, /\| Base \| 2 \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \|/u);
    assert.match(markdown, /\| PR \(Head\) \| 3 \| 1 \| 2 \| 1 \| 1 \| 0 \| 1 \| 0 \| 0 \|/u);
    assert.match(markdown, /\| Merged \| 2 \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \|/u);
});

void test("quality report detects a target synthetic build failure as a regression", () => {
    const baseDir = path.join(workspace, "base/reports");
    const headDir = path.join(workspace, "head/reports");
    const mergeDir = path.join(workspace, "merge/reports");
    const reportFile = path.join(workspace, "reports/summary-report.md");
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });

    writeXml(
        baseDir,
        "build",
        `<testsuites>
      <testsuite name="build">
        <testcase name="pnpm run build:ts" classname="quality.build" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        headDir,
        "build",
        `<testsuites>
      <testsuite name="build">
        <testcase name="pnpm run build:ts" classname="quality.build" />
      </testsuite>
    </testsuites>`
    );

    writeXml(
        mergeDir,
        "build",
        `<testsuites>
      <testsuite name="build">
        <testcase name="pnpm run build:ts" classname="quality.build">
          <failure message="TypeScript workspace build failed" />
        </testcase>
      </testsuite>
    </testsuites>`
    );

    const exitCode = runGenerateQualityReport({
        command: createMockCommand({
            base: baseDir,
            head: headDir,
            merge: mergeDir,
            reportFile
        })
    });

    assert.strictEqual(exitCode, 10);
    const markdown = fs.readFileSync(reportFile, "utf8");
    assert.match(markdown, /❌ Test regressions detected \(Base → Merged\)\./u);
    assert.match(markdown, /build :: pnpm run build:ts/u);
});

void test("command accepts options without positional arguments", async () => {
    const command = createGenerateQualityReportCommand();

    // Test that the command can be invoked with only options, no positional arguments.
    // When testing a subcommand directly via parseAsync, we simulate a CLI invocation
    // with argv containing the process name and script, but the subcommand name itself
    // is handled by the Commander.js framework through the Command instance.
    await command.parseAsync([
        "node",
        "cli.js",
        "--base",
        "report-base",
        "--head",
        "report-head",
        "--merge",
        "report-merge",
        "--report-file",
        "reports/summary-report.md"
    ]);

    const options = command.opts();

    assert.strictEqual(options.base, "report-base");
    assert.strictEqual(options.head, "report-head");
    assert.strictEqual(options.merge, "report-merge");
    assert.strictEqual(options.reportFile, "reports/summary-report.md");
});

void test("command rejects excess positional arguments", async () => {
    const command = createGenerateQualityReportCommand();

    // Try to parse with positional arguments (should fail)
    await assert.rejects(
        async () => {
            await command.parseAsync(["node", "cli.js", "extra-arg", "--base", "report-base"]);
        },
        (error: unknown) => {
            // Commander.js should throw a specific error for excess arguments
            if (!isCommanderErrorLike(error)) {
                return false;
            }

            // Rely on the specific error code rather than message content
            return error.code === "commander.excessArguments";
        }
    );
});
