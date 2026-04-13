import assert from "node:assert/strict";
import { describe, it } from "node:test";

const SKIP_CLI_ENV_VAR = "PRETTIER_PLUGIN_GML_SKIP_CLI_RUN";
const SKIP_CLI_ENV_VALUE = "1";

// The CLI module inspects the environment at import time to decide whether to
// execute. Keep the skip flag scoped to the import cycle so concurrent test
// files do not leak the override into unrelated scenarios.

let cliModulePromise;

async function ensureCliModuleLoaded() {
    if (!cliModulePromise) {
        const originalValue = process.env[SKIP_CLI_ENV_VAR];

        process.env[SKIP_CLI_ENV_VAR] = SKIP_CLI_ENV_VALUE;

        const cleanupEnvironment = () => {
            if (process.env[SKIP_CLI_ENV_VAR] !== SKIP_CLI_ENV_VALUE) {
                return;
            }

            if (originalValue === undefined) {
                delete process.env[SKIP_CLI_ENV_VAR];
            } else {
                process.env[SKIP_CLI_ENV_VAR] = originalValue;
            }
        };

        const moduleLoad = import("../src/cli.js").finally(cleanupEnvironment).catch((error) => {
            cliModulePromise = undefined;
            throw error;
        });

        cliModulePromise = moduleLoad;
    }

    return cliModulePromise;
}

async function loadCliTestUtilities() {
    const { __test__ } = await ensureCliModuleLoaded();
    return __test__;
}

void describe("cli help command normalization", () => {
    void it("passes through arguments when the command is not help", async () => {
        const { normalizeCommandLineArguments } = await loadCliTestUtilities();
        const argumentsForCli = ["format", "src/scripts"];
        const normalized = normalizeCommandLineArguments(argumentsForCli);

        assert.deepEqual(normalized, argumentsForCli);
        assert.notStrictEqual(normalized, argumentsForCli);
    });

    void it("maps bare help commands to the --help flag", async () => {
        const { normalizeCommandLineArguments } = await loadCliTestUtilities();

        assert.deepEqual(normalizeCommandLineArguments(["help"]), ["--help"]);
    });

    void it("converts help <command> into <command> --help", async () => {
        const { normalizeCommandLineArguments } = await loadCliTestUtilities();
        const normalized = normalizeCommandLineArguments(["help", "format"]);

        assert.deepEqual(normalized, ["format", "--help"]);
    });

    void it("treats pnpm-style double-dash help as a top-level help request", async () => {
        const { normalizeCommandLineArguments } = await loadCliTestUtilities();
        const normalized = normalizeCommandLineArguments(["--", "--help"]);

        assert.deepEqual(normalized, ["--help"]);
    });

    void it("strips pnpm argument separators between command and command options", async () => {
        const { normalizeCommandLineArguments } = await loadCliTestUtilities();
        const normalized = normalizeCommandLineArguments(["format", "--", "--write"]);

        assert.deepEqual(normalized, ["format", "--write"]);
    });

    void it("treats implicit format targets with --help as format help requests", async () => {
        const { normalizeCommandLineArguments } = await loadCliTestUtilities();

        assert.deepEqual(normalizeCommandLineArguments(["src", "--help"]), ["format", "--help"]);
    });

    void it("maps implicit format targets to --path when help is not requested", async () => {
        const { normalizeCommandLineArguments } = await loadCliTestUtilities();
        const normalized = normalizeCommandLineArguments(["src/scripts"]);

        assert.deepEqual(normalized, ["format", "--path", "src/scripts"]);
    });
});
