import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    containsHelpFlag,
    FORMAT_ACTION,
    isHelpAliasCommand,
    isHelpRequest,
    isStandaloneHelpRequest,
    normalizeArgumentList,
    normalizeCommandLineArguments,
    resolveDefaultAction,
    resolveHelpAliasArguments,
    resolveHelpAliasCommandArguments,
    stripPnpmArgumentSeparators
} from "../src/cli-core/cli-argument-normalization.js";

void describe("normalizeCommandLineArguments", () => {
    void it("passes through arguments when the command is not help", () => {
        const argumentsForCli = ["format", "src/scripts"];
        const normalized = normalizeCommandLineArguments(argumentsForCli);

        assert.deepEqual(normalized, argumentsForCli);
        assert.notStrictEqual(normalized, argumentsForCli);
    });

    void it("maps bare help commands to the --help flag", () => {
        assert.deepEqual(normalizeCommandLineArguments(["help"]), ["--help"]);
    });

    void it("converts help <command> into <command> --help", () => {
        const normalized = normalizeCommandLineArguments(["help", "format"]);

        assert.deepEqual(normalized, ["format", "--help"]);
    });

    void it("treats pnpm-style double-dash help as a top-level help request", () => {
        const normalized = normalizeCommandLineArguments(["--", "--help"]);

        assert.deepEqual(normalized, ["--help"]);
    });

    void it("strips pnpm argument separators between command and command options", () => {
        const normalized = normalizeCommandLineArguments(["format", "--", "--write"]);

        assert.deepEqual(normalized, ["format", "--write"]);
    });

    void it("treats implicit format targets with --help as format help requests", () => {
        assert.deepEqual(normalizeCommandLineArguments(["src", "--help"]), ["format", "--help"]);
    });

    void it("maps implicit format targets to --path when help is not requested", () => {
        const normalized = normalizeCommandLineArguments(["src/scripts"]);

        assert.deepEqual(normalized, ["format", "--path", "src/scripts"]);
    });
});

void describe("normalizeArgumentList", () => {
    void it("returns an empty array when input is not an array", () => {
        assert.deepEqual(normalizeArgumentList(null), []);
        assert.deepEqual(normalizeArgumentList(undefined), []);
        assert.deepEqual(normalizeArgumentList("hello"), []);
        assert.deepEqual(normalizeArgumentList(42), []);
    });

    void it("returns a copy of the input array", () => {
        const input = ["a", "b", "c"];
        const result = normalizeArgumentList(input);

        assert.deepEqual(result, input);
        assert.notStrictEqual(result, input);
    });

    void it("returns empty array for empty array input", () => {
        assert.deepEqual(normalizeArgumentList([]), []);
    });
});

void describe("stripPnpmArgumentSeparators", () => {
    void it("filters out standalone double-dash separators", () => {
        const input = ["format", "--", "--write", "file.gml"];
        const result = stripPnpmArgumentSeparators(input);

        assert.deepEqual(result, ["format", "--write", "file.gml"]);
    });

    void it("returns empty array when all elements are separators", () => {
        assert.deepEqual(stripPnpmArgumentSeparators(["--"]), []);
    });

    void it("leaves arrays without separators unchanged", () => {
        const input = ["format", "--check", "src"];
        const result = stripPnpmArgumentSeparators(input);

        assert.deepEqual(result, ["format", "--check", "src"]);
    });
});

void describe("containsHelpFlag", () => {
    void it("detects --help flag", () => {
        assert.strictEqual(containsHelpFlag(["format", "--help"]), true);
    });

    void it("detects -h flag", () => {
        assert.strictEqual(containsHelpFlag(["format", "-h"]), true);
    });

    void it("returns false when no help flags present", () => {
        assert.strictEqual(containsHelpFlag(["format", "--check"]), false);
    });

    void it("returns false for empty array", () => {
        assert.strictEqual(containsHelpFlag([]), false);
    });
});

void describe("isHelpRequest", () => {
    void it("returns true for --help", () => {
        assert.strictEqual(isHelpRequest("--help"), true);
    });

    void it("returns true for -h", () => {
        assert.strictEqual(isHelpRequest("-h"), true);
    });

    void it("returns true for help", () => {
        assert.strictEqual(isHelpRequest("help"), true);
    });

    void it("returns false for non-string inputs", () => {
        assert.strictEqual(isHelpRequest(42), false);
        assert.strictEqual(isHelpRequest(null), false);
        assert.strictEqual(isHelpRequest(undefined), false);
    });
});

void describe("isStandaloneHelpRequest", () => {
    void it("returns true for single-element help array", () => {
        assert.strictEqual(isStandaloneHelpRequest(["--help"]), true);
    });

    void it("returns false for multi-element array", () => {
        assert.strictEqual(isStandaloneHelpRequest(["help", "format"]), false);
    });

    void it("returns false for non-help strings", () => {
        assert.strictEqual(isStandaloneHelpRequest(["format"]), false);
    });
});

void describe("isHelpAliasCommand", () => {
    void it("returns true when first element is 'help'", () => {
        assert.strictEqual(isHelpAliasCommand(["help"]), true);
        assert.strictEqual(isHelpAliasCommand(["help", "format"]), true);
    });

    void it("returns false for other first elements", () => {
        assert.strictEqual(isHelpAliasCommand(["format"]), false);
        assert.strictEqual(isHelpAliasCommand([]), false);
    });
});

void describe("resolveHelpAliasCommandArguments", () => {
    void it("maps bare 'help' to --help", () => {
        assert.deepEqual(resolveHelpAliasCommandArguments(["help"]), ["--help"]);
    });

    void it("converts 'help format' to ['format', '--help']", () => {
        assert.deepEqual(resolveHelpAliasCommandArguments(["help", "format"]), ["format", "--help"]);
    });

    void it("handles multi-word commands", () => {
        assert.deepEqual(resolveHelpAliasCommandArguments(["help", "transpile", "src"]), [
            "transpile",
            "src",
            "--help"
        ]);
    });
});

void describe("resolveHelpAliasArguments", () => {
    void it("returns ['--help'] for empty args", () => {
        const result = resolveHelpAliasArguments([]);
        assert.deepEqual(result, ["--help"]);
    });

    void it("returns ['--help'] for standalone help", () => {
        assert.deepEqual(resolveHelpAliasArguments(["help"]), ["--help"]);
    });

    void it("converts 'help format' to ['format', '--help']", () => {
        assert.deepEqual(resolveHelpAliasArguments(["help", "format"]), ["format", "--help"]);
    });
});

void describe("resolveDefaultAction", () => {
    void it("returns 'help' by default when env var is not 'format'", () => {
        assert.strictEqual(resolveDefaultAction(), "help");
    });

    void it("returns 'format' when env var is set to 'format'", () => {
        const original = process.env.PRETTIER_PLUGIN_GML_DEFAULT_ACTION;
        process.env.PRETTIER_PLUGIN_GML_DEFAULT_ACTION = "format";
        try {
            assert.strictEqual(resolveDefaultAction(), "format");
        } finally {
            if (original === undefined) {
                delete process.env.PRETTIER_PLUGIN_GML_DEFAULT_ACTION;
            } else {
                process.env.PRETTIER_PLUGIN_GML_DEFAULT_ACTION = original;
            }
        }
    });
});

void describe("FORMAT_ACTION constant", () => {
    void it("is exported and equals 'format'", () => {
        assert.strictEqual(FORMAT_ACTION, "format");
    });
});
