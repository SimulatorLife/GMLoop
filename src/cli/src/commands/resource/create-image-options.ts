import path from "node:path";

/**
 * Raw CLI option bag supplied by Commander for the `resource create-image`
 * subcommand. Values are strings because Commander defers parsing to the
 * action handler.
 */
export type CreateImageRawOptions = Readonly<{
    width: string;
    height: string;
    color: string;
    color2: string;
    pattern: "solid" | "checkerboard";
    checkerSize: string;
}>;

/**
 * Typed create-image request forwarded to {@link Refactor.createSolidColorPng}.
 *
 * Mirrors {@link Refactor.CreateSolidColorPngRequest} but is intentionally
 * declared locally so the CLI layer does not depend on the refactor workspace
 * just to describe its own option contract.
 */
export type CreateImageRequest = Readonly<{
    width: number;
    height: number;
    color: string;
    color2: string;
    pattern: "solid" | "checkerboard";
    checkerSize: number;
}>;

/**
 * Stable JSON payload emitted after a successful `resource create-image` run.
 *
 * The shape is part of the CLI's public contract: machine consumers and MCP
 * clients rely on `command`, `ok`, and `payload.outputPath` being present.
 */
export type CreateImageResultPayload = Readonly<{
    command: "resource create-image";
    ok: true;
    payload: Readonly<{
        outputPath: string;
        width: number;
        height: number;
        color: string;
        color2: string;
        pattern: "solid" | "checkerboard";
        checkerSize: number;
    }>;
}>;

/**
 * Parse a single CLI string flag into a positive integer.
 *
 * Centralises the `Number.parseInt` + `Number.isFinite` + range check that the
 * `resource create-image` orchestrator repeats for `--width`, `--height`, and
 * `--checker-size`. Keeping the helper isolated here means the action handler
 * reads as a sequence of delegation steps instead of inlining primitive
 * bookkeeping next to its file I/O.
 *
 * @param rawValue   Raw string value supplied via Commander.
 * @param optionName Human-readable name embedded in the error message
 *                   (e.g. `"width"`, `"checker size"`).
 * @returns Parsed positive integer.
 * @throws {Error} When the value cannot be coerced to a finite positive integer.
 */
export function parsePositiveIntegerOption(rawValue: string, optionName: string): number {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid ${optionName}: "${rawValue}". Must be a positive integer.`);
    }
    return parsed;
}

/**
 * Normalize the raw CLI options for `resource create-image` into the typed
 * request accepted by {@link Refactor.createSolidColorPng}.
 *
 * Numeric flags are validated eagerly so the orchestrator can hand the result
 * straight to the refactor API without further guards.
 *
 * @param rawOptions Raw string-typed CLI options.
 * @returns Typed request ready for downstream consumption.
 */
export function parseCreateImageOptions(rawOptions: CreateImageRawOptions): CreateImageRequest {
    return {
        width: parsePositiveIntegerOption(rawOptions.width, "width"),
        height: parsePositiveIntegerOption(rawOptions.height, "height"),
        color: rawOptions.color,
        color2: rawOptions.color2,
        pattern: rawOptions.pattern,
        checkerSize: parsePositiveIntegerOption(rawOptions.checkerSize, "checker size")
    };
}

/**
 * Build the standardized JSON payload emitted after a successful
 * `resource create-image` run.
 *
 * Resolves the output path to an absolute path so downstream tooling does not
 * have to resolve relative paths against the current working directory.
 *
 * @param request    Typed request that was actually rendered to disk.
 * @param outputPath Path the caller passed to the CLI; may be relative.
 */
export function buildCreateImageResultPayload(
    request: CreateImageRequest,
    outputPath: string
): CreateImageResultPayload {
    return {
        command: "resource create-image",
        ok: true,
        payload: {
            outputPath: path.resolve(outputPath),
            width: request.width,
            height: request.height,
            color: request.color,
            color2: request.color2,
            pattern: request.pattern,
            checkerSize: request.checkerSize
        }
    };
}
