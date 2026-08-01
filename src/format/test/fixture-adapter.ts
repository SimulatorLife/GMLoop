import { type FixtureAdapter, FixtureRunner } from "@gmloop/fixture-runner";

import { Format } from "../src/format-entry.js";

/**
 * Create the shared format-fixture adapter used by workspace and aggregate
 * fixture suites.
 *
 * @returns Format fixture adapter backed by the format workspace runtime API.
 */
export function createFormatFixtureAdapter(): FixtureAdapter {
    return Object.freeze({
        workspaceName: "format",
        suiteName: "formatter fixtures",
        supports(kind: string) {
            return kind === "format";
        },
        async run({ config, inputText, runProfiledStage }) {
            const formatOptions = Format.extractProjectFormatOptions(config);
            const formatted = await runProfiledStage(
                "format",
                async () => await Format.format(inputText ?? "", formatOptions)
            );
            const normalized = Format.normalizeFormattedOutput(formatted);
            return {
                resultKind: "text" as const,
                outputText: normalized,
                changed: normalized !== (inputText ?? "")
            };
        }
    });
}

/**
 * Create the canonical format fixture suite definition shared by workspace and
 * aggregate fixture runs.
 *
 * @returns Format fixture suite registration metadata.
 */
export function createFormatFixtureSuiteDefinition() {
    return FixtureRunner.createFixtureSuiteDefinition({
        workspaceName: "format",
        suiteName: "formatter fixtures",
        compiledWorkspaceTestFilePath: "src/format/dist/test/formatter-fixtures.test.js",
        moduleUrl: import.meta.url,
        sourceRelativeSegments: ["fixtures"],
        distRelativeSegments: ["..", "..", "test", "fixtures"],
        adapter: createFormatFixtureAdapter()
    });
}
