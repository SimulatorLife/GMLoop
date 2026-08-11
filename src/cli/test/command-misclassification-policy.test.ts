import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    COMMAND_PATTERN,
    countCommandCharacterDifferences,
    describeHelpCommandSuggestion,
    evaluateCommandMisclassification,
    hasSimilarKnownCommand,
    isCommandInputCandidate,
    isWithinCommandLengthThreshold,
    isWithinCommandSimilarityThreshold,
    MAX_COMMAND_CHARACTER_DIFFERENCES,
    MAX_COMMAND_LENGTH_DIFFERENCE,
    REPOSITORY_HELP_COMMAND,
    resolveClosestKnownCommand
} from "../src/modules/formatting/command-misclassification-policy.js";

const FIXTURE_COMMANDS = new Set(["format", "lint", "refactor", "watch"]);

void describe("command-misclassification policy", () => {
    void describe("constants", () => {
        void it("exposes conservative threshold constants", () => {
            assert.strictEqual(MAX_COMMAND_LENGTH_DIFFERENCE, 2);
            assert.strictEqual(MAX_COMMAND_CHARACTER_DIFFERENCES, 2);
            assert.ok(COMMAND_PATTERN instanceof RegExp);
            assert.strictEqual(typeof REPOSITORY_HELP_COMMAND, "string");
            assert.ok(REPOSITORY_HELP_COMMAND.length > 0);
        });
    });

    void describe("isCommandInputCandidate", () => {
        void it("rejects forward-slash paths", () => {
            assert.equal(isCommandInputCandidate("src/index.ts"), false);
        });

        void it("rejects back-slash paths", () => {
            assert.equal(isCommandInputCandidate(String.raw`src\index.ts`), false);
        });

        void it("rejects tokens ending in a file extension", () => {
            assert.equal(isCommandInputCandidate("script.gml"), false);
        });

        void it("accepts tokens that match the command shape", () => {
            assert.equal(isCommandInputCandidate("format"), true);
            assert.equal(isCommandInputCandidate("lint"), true);
        });
    });

    void describe("isWithinCommandLengthThreshold", () => {
        void it("accepts equal-length strings", () => {
            assert.equal(isWithinCommandLengthThreshold("lint", "lint"), true);
        });

        void it("accepts small length deltas up to the threshold", () => {
            assert.equal(isWithinCommandLengthThreshold("format", "formats"), true);
            assert.equal(isWithinCommandLengthThreshold("format", "frmat"), true);
        });

        void it("rejects large length deltas", () => {
            assert.equal(isWithinCommandLengthThreshold("format", "format-long-tail"), false);
        });
    });

    void describe("countCommandCharacterDifferences", () => {
        void it("returns zero for identical strings", () => {
            assert.equal(countCommandCharacterDifferences("lint", "lint", 2), 0);
        });

        void it("counts single mismatches", () => {
            assert.equal(countCommandCharacterDifferences("lint", "lintx".slice(0, 4), 2), 0);
            assert.equal(countCommandCharacterDifferences("lint", "lInt", 2), 1);
        });

        void it("short-circuits past the configured maximum", () => {
            // The loop breaks the first time the running difference count
            // exceeds the cap, so the return value is one past the cap rather
            // than capped at it.
            assert.equal(countCommandCharacterDifferences("abcde", "zzzzz", 2), 3);
        });

        void it("respects the unbounded sentinel for finding the closest match", () => {
            assert.equal(countCommandCharacterDifferences("format", "frmat", Number.POSITIVE_INFINITY), 4);
        });
    });

    void describe("isWithinCommandSimilarityThreshold", () => {
        void it("rejects differences at or above the absolute cap", () => {
            assert.equal(isWithinCommandSimilarityThreshold(MAX_COMMAND_CHARACTER_DIFFERENCES, 6), true);
            assert.equal(isWithinCommandSimilarityThreshold(MAX_COMMAND_CHARACTER_DIFFERENCES + 1, 6), false);
        });

        void it("rejects differences at or above half the command length", () => {
            assert.equal(isWithinCommandSimilarityThreshold(0, 4), true);
            assert.equal(isWithinCommandSimilarityThreshold(2, 4), false);
        });
    });

    void describe("hasSimilarKnownCommand", () => {
        void it("detects single-character typos within the threshold", () => {
            // 'frrmat' differs from 'format' by exactly one character, which
            // is the smallest real difference count the short-circuit cap
            // still accepts as a near-match.
            assert.equal(hasSimilarKnownCommand("frrmat", FIXTURE_COMMANDS), true);
        });

        void it("detects two-character typos within the threshold", () => {
            assert.equal(hasSimilarKnownCommand("lont", FIXTURE_COMMANDS), true);
        });

        void it("rejects inputs that differ too much from any catalog entry", () => {
            assert.equal(hasSimilarKnownCommand("xyzzy", FIXTURE_COMMANDS), false);
        });

        void it("treats inputs with mismatched case the same as their lowercased form", () => {
            assert.equal(hasSimilarKnownCommand("FORMAT", FIXTURE_COMMANDS), true);
        });
    });

    void describe("resolveClosestKnownCommand", () => {
        void it("returns the closest catalog entry for a single-character typo", () => {
            // 'frrmat' differs from 'format' by exactly one character, which
            // is the smallest real difference count the gate accepts.
            assert.equal(resolveClosestKnownCommand("frrmat", FIXTURE_COMMANDS), "format");
        });

        void it("returns null when no catalog entry is close enough", () => {
            assert.equal(resolveClosestKnownCommand("xyzzy", FIXTURE_COMMANDS), null);
        });

        void it("prefers the entry with the lowest combined score", () => {
            // 'rxfactor' differs from 'refactor' by 1 character but is 1 character longer
            // than 'format' differs from 'format' (0). Combined score picks 'refactor'.
            assert.equal(resolveClosestKnownCommand("rxfactor", FIXTURE_COMMANDS), "refactor");
        });

        void it("rejects inputs whose real difference count exceeds the threshold even with a length match", () => {
            // 'frmat' has length delta 1 against 'format' but 4 real character
            // differences, so the gate rejects the pair.
            assert.equal(resolveClosestKnownCommand("frmat", FIXTURE_COMMANDS), null);
        });
    });

    void describe("describeHelpCommandSuggestion", () => {
        void it("renders the repository and the global invocation hints", () => {
            const suggestion = describeHelpCommandSuggestion("lint");
            assert.ok(suggestion.includes("pnpm run cli -- lint --help"));
            assert.ok(suggestion.includes('"lint --help"'));
        });
    });

    void describe("evaluateCommandMisclassification", () => {
        void it("classifies path-shaped inputs as not-a-candidate", () => {
            assert.deepEqual(
                evaluateCommandMisclassification({ target: "src/index.ts", knownCommands: FIXTURE_COMMANDS }),
                { kind: "not-a-candidate" }
            );
        });

        void it("classifies tokens with file extensions as not-a-candidate", () => {
            assert.deepEqual(
                evaluateCommandMisclassification({ target: "script.gml", knownCommands: FIXTURE_COMMANDS }),
                { kind: "not-a-candidate" }
            );
        });

        void it("classifies exact catalog matches as known-command with a help suggestion", () => {
            const decision = evaluateCommandMisclassification({
                target: "lint",
                knownCommands: FIXTURE_COMMANDS
            });

            assert.equal(decision.kind, "known-command");
            if (decision.kind === "known-command") {
                assert.strictEqual(decision.commandName, "lint");
                assert.ok(decision.helpSuggestion.includes("lint --help"));
            }
        });

        void it("classifies close-but-wrong tokens as probable-typo and names the closest command", () => {
            // 'frrmat' differs from 'format' by exactly one character, which
            // is the only difference count small enough for the
            // resolveClosestKnownCommand gate to suggest a match.
            const decision = evaluateCommandMisclassification({
                target: "frrmat",
                knownCommands: FIXTURE_COMMANDS
            });

            assert.equal(decision.kind, "probable-typo");
            if (decision.kind === "probable-typo") {
                assert.strictEqual(decision.suggestedCommand, "format");
                assert.ok(decision.helpSuggestion.includes("format --help"));
            }
        });

        void it("classifies tokens that match the command pattern but have no close match as unrecognized-candidate", () => {
            const decision = evaluateCommandMisclassification({
                target: "abcde",
                knownCommands: FIXTURE_COMMANDS
            });

            assert.equal(decision.kind, "unrecognized-candidate");
            if (decision.kind === "unrecognized-candidate") {
                assert.ok(decision.helpSuggestion.includes(REPOSITORY_HELP_COMMAND));
            }
        });

        void it("classifies tokens that fail the command pattern as not-a-candidate", () => {
            const decision = evaluateCommandMisclassification({
                target: "1abc",
                knownCommands: FIXTURE_COMMANDS
            });

            assert.equal(decision.kind, "not-a-candidate");
        });

        void it("ignores the catalog identity by using the injected known-commands set", () => {
            // 'lint' is a real CLI command but absent from the isolated
            // fixture set. Closest match against {format} has four real
            // differences (above MAX_COMMAND_CHARACTER_DIFFERENCES), so the
            // evaluator must classify it as unrecognized rather than
            // reaching for the production command catalog.
            const decision = evaluateCommandMisclassification({
                target: "lint",
                knownCommands: new Set(["format"])
            });

            assert.equal(decision.kind, "unrecognized-candidate");
        });
    });
});
