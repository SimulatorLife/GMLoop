import process from "node:process";

/**
 * Canonical exit code used by every JSON error response emitted from a CLI
 * command. Centralising the literal keeps the contract explicit so any
 * future override (for example `--fatal-exit-code <n>` flags) has a single
 * place to change.
 */
const DEFAULT_JSON_ERROR_EXIT_CODE = 1;

/**
 * Options for {@link emitJsonErrorAndExit}. The shape mirrors the existing
 * `live-reload` and `symbol inspect` payload envelopes so existing consumers
 * (notably the auto-game skills catalog and the MCP stdio bridge) keep
 * receiving the exact JSON they already parse.
 */
export interface EmitJsonErrorAndExitOptions {
    /** Stable command identifier written to the `command` field of the payload. */
    readonly command: string;
    /** Machine-readable error code (for example `"connection_failed"`). */
    readonly code: string;
    /** Human-readable error message. Also echoed to stderr for log capture. */
    readonly error: string;
    /**
     * Optional extra fields merged into the JSON payload after `command`,
     * `ok`, `code`, and `error`. Use this for command-specific metadata such
     * as the `candidates` array returned by `symbol inspect` ambiguity
     * errors. The values must be JSON-serialisable.
     */
    readonly extras?: Record<string, unknown>;
    /** Optional exit code override. Defaults to {@link DEFAULT_JSON_ERROR_EXIT_CODE}. */
    readonly exitCode?: number;
}

/**
 * Emit a structured JSON error response on stdout, echo the human-readable
 * message to stderr, and terminate the process with the supplied exit code.
 *
 * Several CLI commands (`live-reload session`, `live-reload wait-for-patch`,
 * `symbol inspect`) used to inline the payload-construction, stdout write,
 * stderr write, and `process.exit(1)` sequence in every failure branch.
 * Diverging copies of that sequence drifted in subtle ways — some omitted
 * the stderr echo, some used different exit codes, some lost the `ok` flag.
 * Centralising the behaviour here guarantees a single source of truth for
 * the response envelope and the surrounding logging expectations.
 *
 * The function is marked `never` because `process.exit` terminates the
 * process; TypeScript callers therefore cannot forget to short-circuit
 * subsequent code paths after a JSON error response.
 *
 * @param options - Command identifier, machine-readable code, human message,
 *                  optional command-specific extras, and optional exit code
 * override.
 */
export function emitJsonErrorAndExit(options: EmitJsonErrorAndExitOptions): never {
    const exitCode = options.exitCode ?? DEFAULT_JSON_ERROR_EXIT_CODE;
    const payload: Record<string, unknown> = {
        command: options.command,
        ok: false,
        code: options.code,
        error: options.error,
        ...options.extras
    };

    console.log(JSON.stringify(payload, null, 2));
    console.error(options.error);
    process.exit(exitCode);
}
