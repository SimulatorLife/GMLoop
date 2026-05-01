import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import {
    type PlannedSurfaceSharedOptions,
    reportUnsupportedPlannedSurfaceBackend
} from "./planned-ai-surface-shared.js";

function addTestSharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).option("--json", "Emit JSON output.");
}

export function createTestCommand(): Command {
    const command = applyStandardCommandOptions(new Command("test")).description("Discover and execute test suites.");

    const run = addTestSharedOptions(
        applyStandardCommandOptions(new Command("run")).description("Run AI-targeted command tests (planned backend).")
    );
    run.action(function testRunAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "test run",
            options,
            "Dedicated AI test-run backend is not implemented.",
            [
                "Define AI suite selection and execution orchestration in CLI test modules.",
                "Integrate with existing node test runner command wrappers."
            ]
        );
    });

    const list = addTestSharedOptions(
        applyStandardCommandOptions(new Command("list")).description("List test suites.")
    );
    list.action(function testListAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend("test list", options, "Test-suite catalog backend is not implemented.", [
            "Define discoverable AI test metadata catalog.",
            "Expose suite metadata via a stable command payload contract."
        ]);
    });

    const results = addTestSharedOptions(
        applyStandardCommandOptions(new Command("results")).description("Read latest test run results.")
    );
    results.action(function testResultsAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend("test results", options, "Test results backend is not implemented.", [
            "Persist test run artifacts for results lookups.",
            "Expose durable status querying API for CLI and MCP."
        ]);
    });

    const testCase = applyStandardCommandOptions(new Command("case")).description("Manage test cases.");
    const testCaseCreate = addTestSharedOptions(
        applyStandardCommandOptions(new Command("create")).description("Create a test case.")
    );
    testCaseCreate.action(function testCaseCreateAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "test case create",
            options,
            "Test case creation backend is not implemented.",
            ["Define test-case schema and persistence layout.", "Implement creation flow in CLI test modules."]
        );
    });
    const testCaseUpdate = addTestSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update a test case.")
    );
    testCaseUpdate.action(function testCaseUpdateAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "test case update",
            options,
            "Test case update backend is not implemented.",
            ["Add test-case edit transactions and validation.", "Expose case update payload contract for MCP."]
        );
    });
    testCase.addCommand(testCaseCreate);
    testCase.addCommand(testCaseUpdate);

    command.addCommand(run);
    command.addCommand(list);
    command.addCommand(results);
    command.addCommand(testCase);
    return command;
}
