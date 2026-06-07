import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import {
    clearIdentifierCaseDryRunContexts,
    setIdentifierCaseDryRunContext
} from "../src/identifier-case/identifier-case-helpers.js";
import { maybeReportIdentifierCaseDryRun } from "../src/identifier-case/identifier-case-report.js";
import { prepareIdentifierCasePlan } from "../src/identifier-case/plan-service.js";
import {
    createIdentifierCaseProject,
    getFormat,
    resolveIdentifierCaseFixturesDirectory
} from "./identifier-case-test-helpers.js";

// Use Core.* per AGENTS.md rather than destructuring the namespace.

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const fixturesDirectory = resolveIdentifierCaseFixturesDirectory(currentDirectory);

async function createTempProject(fixtureFileName = "locals.gml") {
    const project = await createIdentifierCaseProject({
        fixturesDirectory,
        scriptFixtures: [{ name: "demo", fixture: fixtureFileName }],
        eventFixture: null
    });

    return {
        projectRoot: project.projectRoot,
        fixtureSource: project.scriptSources[0],
        gmlPath: project.scriptPaths[0],
        projectIndex: project.projectIndex
    };
}

function collectIdentifierCaseConflictCodes(summaryDiagnostic, summaryText) {
    const codes = new Set<string>();
    for (const conflict of summaryDiagnostic.conflicts ?? []) {
        if (conflict?.code) {
            codes.add(conflict.code);
        }
    }

    if (codes.size === 0) {
        for (const line of summaryText.split("\n")) {
            if (line.includes("[preserve]")) {
                codes.add("preserve");
            }
            if (line.includes("[ignored]")) {
                codes.add("ignored");
            }
            if (line.includes("[collision]")) {
                codes.add("collision");
            }
        }
    }

    return codes;
}

void describe("identifier case local renaming", { concurrency: false }, () => {
    void it("reports planned renames and conflicts during dry-run", async () => {
        const { projectRoot, fixtureSource, gmlPath, projectIndex } = await createTempProject();

        const consoleMessages = [];
        const restoreConsole = mock.method(console, "log", (...args) => {
            consoleMessages.push(args.join(" "));
        });

        try {
            clearIdentifierCaseDryRunContexts();
            const messages = [];
            const logger = {
                log(message) {
                    messages.push(message);
                },
                warn(message) {
                    messages.push(`WARN: ${message}`);
                }
            };
            const diagnostics = [];
            setIdentifierCaseDryRunContext({
                filepath: gmlPath,
                projectIndex,
                dryRun: true,
                logger,
                diagnostics
            });

            const formatOptions = {
                filepath: gmlPath,
                gmlIdentifierCase: "camel",
                gmlIdentifierCaseFunctions: "off",
                gmlIdentifierCaseStructs: "off",
                gmlIdentifierCaseMacros: "off",
                gmlIdentifierCaseInstance: "off",
                gmlIdentifierCaseGlobals: "off",
                gmlIdentifierCaseAssets: "off",
                gmlIdentifierCaseIgnore: "ignore*",
                gmlIdentifierCasePreserve: "preserve_me",
                __identifierCaseProjectIndex: projectIndex,
                __identifierCaseDryRun: true,
                diagnostics,
                logger
            };

            const formatWorkspace = await getFormat();
            const formatted = await formatWorkspace.format(fixtureSource, formatOptions);
            await prepareIdentifierCasePlan(formatOptions);
            maybeReportIdentifierCaseDryRun(formatOptions);

            assert.ok(formatted.includes("counter_value"), "Dry-run should not rewrite identifiers in the source");
            assert.ok(!formatted.includes("counterValue"), "Dry-run should not apply rename targets");

            const combinedMessages = messages.length > 0 ? messages : consoleMessages;
            assert.ok(combinedMessages.length > 0, "Expected reporting output to be logged");
            const summaryText = combinedMessages.join("\n");
            assert.match(summaryText, /Planned renames: 1/);
            assert.match(summaryText, /Conflicts: 3/);
            assert.match(summaryText, /counter_value -> counterValue/);

            const summaryDiagnostic =
                Core.isNonEmptyArray(diagnostics) &&
                diagnostics.find((entry) => entry?.code === "gml-identifier-case-summary");

            if (!summaryDiagnostic) {
                assert.fail("Expected identifier case summary diagnostic to be emitted");
            }

            assert.strictEqual(summaryDiagnostic.summary.renameCount, 1);
            assert.strictEqual(summaryDiagnostic.summary.conflictCount, 3);

            const renamePlan = summaryDiagnostic.renames ?? [];
            assert.strictEqual(renamePlan.length, 1);
            const [operation] = renamePlan;
            assert.strictEqual(operation.fromName, "counter_value");
            assert.strictEqual(operation.toName, "counterValue");

            const codes = collectIdentifierCaseConflictCodes(summaryDiagnostic, summaryText);

            assert.ok(codes.has("preserve"));
            assert.ok(codes.has("ignored"));
            assert.ok(codes.has("collision"));
        } finally {
            restoreConsole.mock.restore();
            clearIdentifierCaseDryRunContexts();
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });

    void it("does not apply local identifier renames in format write mode", async () => {
        const { projectRoot, fixtureSource, gmlPath, projectIndex } = await createTempProject();

        try {
            clearIdentifierCaseDryRunContexts();
            setIdentifierCaseDryRunContext({
                filepath: gmlPath,
                projectIndex,
                dryRun: false
            });
            const diagnostics = [];
            const formatOptions = {
                filepath: gmlPath,
                gmlIdentifierCase: "camel",
                gmlIdentifierCaseFunctions: "off",
                gmlIdentifierCaseStructs: "off",
                gmlIdentifierCaseMacros: "off",
                gmlIdentifierCaseInstance: "off",
                gmlIdentifierCaseGlobals: "off",
                gmlIdentifierCaseAssets: "off",
                gmlIdentifierCaseIgnore: "ignore*",
                gmlIdentifierCasePreserve: "preserve_me",
                __identifierCaseProjectIndex: projectIndex,
                __identifierCaseDryRun: false,
                diagnostics
            };

            const formatWorkspace = await getFormat();
            const formatted = await formatWorkspace.format(fixtureSource, formatOptions);

            assert.match(formatted, /counter_value/);
            assert.match(formatted, /preserve_me/);
            assert.match(formatted, /ignore_temp/);
            assert.match(formatted, /foo_bar/);
            assert.match(formatted, /fooBar/);

            assert.ok(!formatted.includes("counterValue"), "Formatter must not apply semantic identifier rewrites");
            assert.strictEqual(diagnostics.length, 0);
        } finally {
            clearIdentifierCaseDryRunContexts();
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });

    void it("keeps dry-run and write output identical for eligible locals", async () => {
        const { projectRoot, fixtureSource, gmlPath, projectIndex } = await createTempProject("locals-write.gml");

        const baseOptions = {
            filepath: gmlPath,
            gmlIdentifierCase: "camel",
            gmlIdentifierCaseFunctions: "off",
            gmlIdentifierCaseStructs: "off",
            gmlIdentifierCaseMacros: "off",
            gmlIdentifierCaseInstance: "off",
            gmlIdentifierCaseGlobals: "off",
            gmlIdentifierCaseAssets: "off",
            __identifierCaseProjectIndex: projectIndex
        };

        try {
            clearIdentifierCaseDryRunContexts();
            setIdentifierCaseDryRunContext({
                filepath: gmlPath,
                projectIndex,
                dryRun: true
            });

            const dryRunOptions = {
                ...baseOptions,
                __identifierCaseDryRun: true,
                diagnostics: [],
                logger: { log() {} }
            };

            const formatWorkspace = await getFormat();
            const dryRunOutput = await formatWorkspace.format(fixtureSource, dryRunOptions);

            assert.match(dryRunOutput, /should_rename/);
            assert.ok(!dryRunOutput.includes("shouldRename"), "Dry-run should preserve original identifier spelling");

            clearIdentifierCaseDryRunContexts();
            setIdentifierCaseDryRunContext({
                filepath: gmlPath,
                projectIndex,
                dryRun: false
            });

            const writeOptions = {
                ...baseOptions,
                __identifierCaseDryRun: false,
                diagnostics: []
            };

            const writeOutput = await formatWorkspace.format(fixtureSource, writeOptions);

            assert.match(writeOutput, /should_rename/);
            assert.ok(!writeOutput.includes("shouldRename"), "Formatter must not apply semantic identifier rewrites");

            const writeReportOptions = {
                ...baseOptions,
                __identifierCaseDryRun: false
            };
            await prepareIdentifierCasePlan(writeReportOptions);
            const writeReport = maybeReportIdentifierCaseDryRun(writeReportOptions);
            assert.ok(writeReport, "Expected write mode report to be recorded");
            assert.strictEqual(writeReport.summary.renameCount, 1);
            assert.strictEqual(writeReport.summary.conflictCount, 0);
        } finally {
            clearIdentifierCaseDryRunContexts();
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });
});
