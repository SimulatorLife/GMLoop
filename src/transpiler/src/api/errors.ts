/**
 * Structured error codes for the GML transpiler.
 *
 * These codes are attached to errors thrown by the transpiler, enabling
 * consumers to classify and handle errors programmatically without relying
 * on fragile string matching on error messages.
 *
 * The error codes are designed to be stable surface area—changes to the
 * transpiler's internal implementation should not require new codes.
 * Codes are only added when the consumer's handling path genuinely differs
 * based on the error category.
 */
export const TranspilerErrorCode = Object.freeze({
    /**
     * The source text was syntactically malformed and could not be parsed.
     * This code is set by the parser layer before the transpiler processes
     * the AST. Consumers should surface the parse error location to the user.
     */
    PARSE_ERROR: "PARSE_ERROR",

    /**
     * The transpiler produced output that failed internal validation.
     * This typically indicates a bug in the transpiler itself and should
     * be reported. The original error is preserved as the `cause`.
     */
    VALIDATION_ERROR: "VALIDATION_ERROR",

    /**
     * The input request was malformed—required fields were missing,
     * had the wrong type, or were empty strings where non-empty values
     * were expected. This code is set by the public API entry points
     * (`transpileScript`, `transpileEvent`, `transpileClosure`).
     */
    REQUEST_ERROR: "REQUEST_ERROR",

    /**
     * The transpiler encountered an unexpected error while processing
     * a syntactically valid AST. This may indicate an unsupported GML
     * language construct or an internal implementation issue. The original
     * error is preserved as the `cause`.
     */
    INTERNAL_ERROR: "INTERNAL_ERROR"
} as const);

/**
 * Literal type for all known transpiler error codes.
 */
export type TranspilerErrorCode = (typeof TranspilerErrorCode)[keyof typeof TranspilerErrorCode];

/**
 * Error thrown by the GML transpiler when a transpilation operation fails.
 *
 * Instances carry a human-readable `message`, an optional `cause` for the
 * underlying error, and a `code` drawn from {@link TranspilerErrorCode}
 * that consumers can inspect to determine the error category without parsing
 * the message string.
 */
export class TranspilerError extends Error {
    /**
     * The structured error code classifying this failure.
     */
    readonly code: TranspilerErrorCode;

    constructor(message: string, code: TranspilerErrorCode, options?: { cause?: unknown }) {
        super(message, options);
        this.name = "TranspilerError";
        this.code = code;
    }
}
