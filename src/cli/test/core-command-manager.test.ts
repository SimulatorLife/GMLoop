import assert from "node:assert/strict";
import { test } from "node:test";

import { Command } from "commander";

import { createCliCommandManager } from "../src/cli-core/command-manager.js";
import { applyStandardCommandOptions } from "../src/cli-core/command-standard-options.js";
import { CliUsageError } from "../src/cli-core/errors.js";

function createStubProgram() {
    const hooks = new Map();
    const registeredCommands = [];
    return {
        parseCalls: [],
        addCommand(command, options: { isDefault?: boolean } = {}): typeof this {
            registeredCommands.push({ command, options });
            if (options.isDefault) {
                this.defaultCommand = command;
            }
            return this;
        },
        hook(name, handler) {
            hooks.set(name, handler);
            return this;
        },
        parse(argv, options) {
            this.parseCalls.push({ argv, options });
            const nonDefault = registeredCommands.find((entry) => entry.options?.isDefault !== true);
            const targetCommand = nonDefault?.command ?? this.defaultCommand ?? null;
            const action = targetCommand?._actionHandler;
            if (!action) {
                return;
            }

            hooks.get("preSubcommand")?.(this, targetCommand);
            return Promise.resolve()
                .then(() => action(argv.slice(1), targetCommand))
                .finally(() => {
                    hooks.get("postAction")?.();
                });
        },
        helpInformation() {
            return "stub program usage";
        }
    };
}

function createAsyncStubProgram() {
    const hooks = new Map();
    const registeredCommands = [];
    return {
        parseCalls: [],
        parseAsyncCalls: [],
        addCommand(command, options: { isDefault?: boolean } = {}): typeof this {
            registeredCommands.push({ command, options });
            if (options.isDefault) {
                this.defaultCommand = command;
            }
            return this;
        },
        hook(name, handler) {
            hooks.set(name, handler);
            return this;
        },
        parse() {
            throw new Error("parse() should not be used when parseAsync() is available");
        },
        async parseAsync(argv, options) {
            this.parseAsyncCalls.push({ argv, options });
            const nonDefault = registeredCommands.find((entry) => entry.options?.isDefault !== true);
            const targetCommand = nonDefault?.command ?? this.defaultCommand ?? null;
            const action = targetCommand?._actionHandler;
            if (!action) {
                return;
            }

            hooks.get("preSubcommand")?.(this, targetCommand);
            try {
                await action(argv.slice(1), targetCommand);
            } finally {
                hooks.get("postAction")?.();
            }
        },
        helpInformation() {
            return "stub program usage";
        }
    };
}

function createStubCommand(name) {
    return {
        _actionHandler: null,
        action(handler) {
            this._actionHandler = handler;
            return this;
        },
        helpInformation() {
            return `${name} usage`;
        },
        name() {
            return name;
        }
    };
}

void test("default command usage is reported for option parsing errors", async () => {
    const program = applyStandardCommandOptions(new Command());
    const unhandledErrors = [];
    const { registry, runner } = createCliCommandManager({
        program,
        onUnhandledError: (error, context) => {
            unhandledErrors.push({ error, command: context.command });
        }
    });

    const capturedErrors = [];
    const defaultCommand = applyStandardCommandOptions(new Command("format"));
    defaultCommand.option("--extensions <list>");

    registry.registerDefaultCommand({
        command: defaultCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    await runner.run(["format", "--extensions"]);

    assert.deepStrictEqual(unhandledErrors, []);
    assert.strictEqual(capturedErrors.length, 1);

    const [{ error, command }] = capturedErrors;
    assert.ok(error instanceof CliUsageError);
    assert.strictEqual(command.name(), "format");
    assert.ok(error.usage?.includes("format"));
    assert.ok(error.usage?.includes("--extensions"));
});

void test("subcommand usage is reported when Commander omits command reference", async () => {
    const program = applyStandardCommandOptions(new Command());
    const unhandledErrors = [];
    const { registry, runner } = createCliCommandManager({
        program,
        onUnhandledError: (error, context) => {
            unhandledErrors.push({ error, command: context.command });
        }
    });

    const defaultCommand = applyStandardCommandOptions(new Command("format"));
    registry.registerDefaultCommand({ command: defaultCommand });

    const capturedErrors = [];
    const performanceCommand = applyStandardCommandOptions(new Command("performance"));
    performanceCommand.option("--stdout");

    registry.registerCommand({
        command: performanceCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    await runner.run(["performance", "--stdout", "human"]);

    assert.deepStrictEqual(unhandledErrors, []);
    assert.strictEqual(capturedErrors.length, 1);

    const [{ error, command }] = capturedErrors;
    assert.ok(error instanceof CliUsageError);
    assert.strictEqual(command.name(), "performance");
    assert.ok(error.message.includes("performance"));
    assert.ok(error.usage?.includes("performance"));
    assert.ok(error.usage?.includes("--stdout"));
});

void test("command manager adapts programs that only expose parse()", async () => {
    const program = createStubProgram();
    const { registry, runner } = createCliCommandManager({ program });

    const executed = [];
    const command = createStubCommand("adapter");

    registry.registerCommand({
        command,
        run: () => {
            executed.push("run");
            return 0;
        }
    });

    await runner.run(["adapter", "--flag"]);

    assert.deepStrictEqual(program.parseCalls, [{ argv: ["adapter", "--flag"], options: { from: "user" } }]);
    assert.deepStrictEqual(executed, ["run"]);
});

void test("command manager prefers parseAsync when available on Commander executors", async () => {
    const program = createAsyncStubProgram();
    const { registry, runner } = createCliCommandManager({ program });

    const executed = [];
    const command = createStubCommand("adapter");

    registry.registerCommand({
        command,
        run: () => {
            executed.push("run");
            return 0;
        }
    });

    await runner.run(["adapter", "--flag"]);

    assert.deepStrictEqual(program.parseAsyncCalls, [{ argv: ["adapter", "--flag"], options: { from: "user" } }]);
    assert.deepStrictEqual(executed, ["run"]);
});

void test("missing required subcommand prints the command help and exits cleanly", async () => {
    const program = applyStandardCommandOptions(new Command());
    const { registry, runner } = createCliCommandManager({ program });

    const unhandledErrors = [];
    const capturedErrors = [];

    const graphCommand = applyStandardCommandOptions(new Command("graph")).description("graph index");
    graphCommand.command("index").action(() => {});
    graphCommand.command("search").action(() => {});

    registry.registerCommand({
        command: graphCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    const captured = await captureStdIO(() => runner.run(["graph"]));

    assert.deepStrictEqual(unhandledErrors, []);
    assert.deepStrictEqual(capturedErrors, []);

    assert.match(captured.stdout, /Usage: [^\n]+\bgraph\b/);
    assert.match(captured.stdout, /graph index/);
    assert.match(captured.stdout, /\bindex\b/);
    assert.match(captured.stdout, /\bsearch\b/);
    assert.doesNotMatch(captured.stdout, /\(outputHelp\)/u);
    assert.doesNotMatch(captured.stderr, /\(outputHelp\)/u);
    assert.doesNotMatch(captured.stderr, /add --help for usage information/u);
});

void test("explicit --help on a subcommand-group still renders help without error noise", async () => {
    const program = applyStandardCommandOptions(new Command());
    const { registry, runner } = createCliCommandManager({ program });

    const capturedErrors = [];

    const graphCommand = applyStandardCommandOptions(new Command("graph")).description("graph index");
    graphCommand.command("index").action(() => {});
    graphCommand.command("search").action(() => {});

    registry.registerCommand({
        command: graphCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    const captured = await captureStdIO(() => runner.run(["graph", "--help"]));

    assert.deepStrictEqual(capturedErrors, []);

    assert.match(captured.stdout, /Usage: [^\n]+\bgraph\b/);
    assert.match(captured.stdout, /graph index/);
    assert.match(captured.stdout, /\bindex\b/);
    assert.match(captured.stdout, /\bsearch\b/);
    assert.doesNotMatch(captured.stdout, /\(outputHelp\)/u);
    assert.doesNotMatch(captured.stderr, /\(outputHelp\)/u);
    assert.doesNotMatch(captured.stderr, /add --help for usage information/u);
});

void test("missing required subcommand on a registered subcommand also recovers help", async () => {
    const program = applyStandardCommandOptions(new Command());
    const { registry, runner } = createCliCommandManager({ program });

    const capturedErrors = [];
    const validateCommand = applyStandardCommandOptions(new Command("validate")).description(
        "Validate file/project/room/resource targets."
    );
    validateCommand
        .command("file")
        .argument("<target>", "Path to a .gml file.")
        .action(() => {});

    registry.registerCommand({
        command: validateCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    const captured = await captureStdIO(() => runner.run(["validate"]));

    assert.deepStrictEqual(capturedErrors, []);

    assert.match(captured.stdout, /Usage: [^\n]+\bvalidate\b/);
    assert.match(captured.stdout, /Validate file\/project\/room\/resource targets\./);
    assert.match(captured.stdout, /\bfile\b/);
    assert.doesNotMatch(captured.stdout, /\(outputHelp\)/u);
    assert.doesNotMatch(captured.stderr, /\(outputHelp\)/u);
});

void test("positional path arguments are translated into an actionable --path suggestion", async () => {
    const program = applyStandardCommandOptions(new Command()).exitOverride();
    const { registry, runner } = createCliCommandManager({
        program,
        onUnhandledError: () => {}
    });

    const capturedErrors = [];
    const formatCommand = applyStandardCommandOptions(new Command("format")).description(
        "Format GameMaker Language files using the prettier plugin."
    );
    formatCommand.option("--path <path>", "Target .gml file or directory path.");
    formatCommand.option("--write", "Apply changes to files.");

    registry.registerDefaultCommand({
        command: formatCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    await runner.run(["format", "/tmp/project"]);

    assert.strictEqual(capturedErrors.length, 1);
    const [{ error }] = capturedErrors;
    assert.ok(error instanceof CliUsageError);
    assert.match(error.message, /'format' command does not accept a positional path argument/);
    assert.match(error.message, /--path \/tmp\/project/);
    assert.doesNotMatch(error.message, /too many arguments for 'format'/u);
});

void test("positional path arguments without a --path option use the generic guidance", async () => {
    const program = applyStandardCommandOptions(new Command()).exitOverride();
    const { registry, runner } = createCliCommandManager({
        program,
        onUnhandledError: () => {}
    });

    const capturedErrors = [];
    const statsCommand = applyStandardCommandOptions(new Command("collect-stats")).description(
        "Collect project health statistics."
    );
    statsCommand.option("--json", "Emit machine-readable JSON output.");

    registry.registerCommand({
        command: statsCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    await runner.run(["collect-stats", "/tmp/project"]);

    assert.strictEqual(capturedErrors.length, 1);
    const [{ error }] = capturedErrors;
    assert.ok(error instanceof CliUsageError);
    assert.match(error.message, /'collect-stats' command does not accept positional arguments/);
    assert.match(error.message, /'\/tmp\/project'/);
    assert.match(error.message, /--help/);
    assert.doesNotMatch(error.message, /--path/u);
});

void test("multiple positional arguments on a --path command explain the single-target rule", async () => {
    const program = applyStandardCommandOptions(new Command()).exitOverride();
    const { registry, runner } = createCliCommandManager({
        program,
        onUnhandledError: () => {}
    });

    const capturedErrors = [];
    const fixCommand = applyStandardCommandOptions(new Command("fix")).description(
        "Run project codemods, lint fixes, and formatting in sequence."
    );
    fixCommand.option("--path <path>", "Target .gml file or directory path.");

    registry.registerCommand({
        command: fixCommand,
        onError: (error, context) => {
            capturedErrors.push({ error, command: context.command });
        }
    });

    await runner.run(["fix", "/tmp/project", "/tmp/other"]);

    assert.strictEqual(capturedErrors.length, 1);
    const [{ error }] = capturedErrors;
    assert.ok(error instanceof CliUsageError);
    assert.match(error.message, /'\/tmp\/project'/);
    assert.match(error.message, /'\/tmp\/other'/);
    assert.match(error.message, /single '--path <target>'/);
});

interface CapturedStreams {
    stdout: string;
    stderr: string;
}

type WriteEncodingOrCallback = BufferEncoding | ((error?: Error | null) => void) | undefined;

type WriteCallback = (error?: Error | null) => void;

type NodeWrite = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | WriteCallback,
    callback?: WriteCallback
) => boolean;

async function captureStdIO(callback: () => Promise<unknown>): Promise<CapturedStreams> {
    const originalStdoutWrite: NodeWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite: NodeWrite = process.stderr.write.bind(process.stderr);
    let stdout = "";
    let stderr = "";

    const captureChunk = (
        buffer: string,
        chunk: string | Uint8Array,
        encodingOrCallback: WriteEncodingOrCallback
    ): string => {
        if (typeof chunk === "string") {
            return buffer + chunk;
        }
        const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
        return buffer + Buffer.from(chunk).toString(encoding);
    };

    const stdoutStub: NodeWrite = (chunk, encodingOrCallback, cb) => {
        stdout = captureChunk(stdout, chunk, encodingOrCallback);
        const completion = typeof encodingOrCallback === "function" ? encodingOrCallback : cb;
        if (typeof completion === "function") {
            completion();
        }
        return true;
    };

    const stderrStub: NodeWrite = (chunk, encodingOrCallback, cb) => {
        stderr = captureChunk(stderr, chunk, encodingOrCallback);
        const completion = typeof encodingOrCallback === "function" ? encodingOrCallback : cb;
        if (typeof completion === "function") {
            completion();
        }
        return true;
    };

    Object.assign(process.stdout, { write: stdoutStub });
    Object.assign(process.stderr, { write: stderrStub });

    try {
        await callback();
    } finally {
        Object.assign(process.stdout, { write: originalStdoutWrite });
        Object.assign(process.stderr, { write: originalStderrWrite });
    }

    return { stdout, stderr };
}
