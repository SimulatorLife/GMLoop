import type { FixtureAdapter } from "@gmloop/fixture-runner";

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
