import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

type PullRequestFileChange = Readonly<{
    filename: string;
    previous_filename?: string;
    status: "added" | "removed" | "modified" | "renamed";
}>;

const protectedGoldenFixturePatterns = [
    /^test\/fixtures\/plugin-integration\/.*\.gml$/u,
    /^src\/parser\/test\/input\/.*\.gml$/u,
    /^src\/lint\/test\/fixtures\/.*\.gml$/u
];

function isProtectedGoldenFixture(filename: string | undefined): boolean {
    if (typeof filename !== "string") {
        return false;
    }

    return protectedGoldenFixturePatterns.some((pattern) => pattern.test(filename));
}

function shouldBlockFixtureChange(fileChange: PullRequestFileChange): boolean {
    if (fileChange.status === "added") {
        return false;
    }

    return isProtectedGoldenFixture(fileChange.filename) || isProtectedGoldenFixture(fileChange.previous_filename);
}

void test("golden fixture guard blocks only protected fixture modifications/removals/renames", () => {
    const changedFiles: ReadonlyArray<PullRequestFileChange> = [
        {
            filename: "src/lint/test/fixtures/no-unnecessary-string-interpolation/input.gml",
            status: "modified"
        },
        {
            filename: "src/parser/test/input/functions/new-input.gml",
            status: "removed"
        },
        {
            filename: "test/fixtures/plugin-integration/suite/input.gml",
            status: "renamed",
            previous_filename: "test/fixtures/plugin-integration/suite/old-name.gml"
        },
        {
            filename: "src/format/test/fixtures/test-argument-docs/expected.gml",
            status: "modified"
        },
        {
            filename: "docs/examples/demo.gml",
            status: "modified"
        },
        {
            filename: "src/lint/test/fixtures/new-rule/input.gml",
            status: "added"
        }
    ];

    const blocked = changedFiles.filter((change) => shouldBlockFixtureChange(change)).map((change) => change.filename);

    assert.deepEqual(blocked, [
        "src/lint/test/fixtures/no-unnecessary-string-interpolation/input.gml",
        "src/parser/test/input/functions/new-input.gml",
        "test/fixtures/plugin-integration/suite/input.gml"
    ]);
});

void test("auto-merge workflows keep narrowed golden fixture guard paths", async () => {
    const workflowPaths = [
        path.resolve(process.cwd(), ".github/workflows/automerge-prs.yml"),
        path.resolve(process.cwd(), ".github/workflows/auto-merge-agent.yml")
    ];

    for (const workflowPath of workflowPaths) {
        const source = await readFile(workflowPath, "utf8");

        assert.match(source, /test\\\/fixtures\\\/plugin-integration\\\/.\*\\\.gml/u);
        assert.match(source, /src\\\/parser\\\/test\\\/input\\\/.\*\\\.gml/u);
        assert.match(source, /src\\\/lint\\\/test\\\/fixtures\\\/.\*\\\.gml/u);

        assert.doesNotMatch(source, /f\.filename\.includes\('\/test\/'\)/u);
    }
});

void test("automerge regression agent comment includes quality report regression summary context", async () => {
    const automergeWorkflowPath = path.resolve(process.cwd(), ".github/workflows/automerge-prs.yml");
    const source = await readFile(automergeWorkflowPath, "utf8");

    assert.match(source, /Regression summary from the Quality Report:/u);
    assert.match(source, /line\.trim\(\)\.startsWith\('❌ Test regressions detected\.'\)/u);
});
