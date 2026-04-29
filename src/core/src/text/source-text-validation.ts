/**
 * Runtime validation for external parser inputs.
 *
 * This module provides defensive checks for untrusted data entering the parser
 * to prevent crashes, DoS attacks, and other failure modes. All validations
 * fail fast with clear error messages.
 */

const DEFAULT_MAX_SOURCE_LENGTH = 10 * 1024 * 1024; // 10MB

/**
 * Configuration for source text validation.
 */
export interface SourceTextValidationOptions {
    /**
     * Maximum allowed source text length in characters.
     * Defaults to 10MB (10,485,760 characters).
     */
    maxLength?: number;

    /**
     * Whether to allow empty source text.
     * When false, empty strings are rejected with a validation error.
     * Defaults to true.
     */
    allowEmpty?: boolean;
}

/**
 * Error thrown when source text validation fails.
 */
export class SourceTextValidationError extends TypeError {
    constructor(message: string) {
        super(message);
        this.name = "SourceTextValidationError";
    }
}

/**
 * Validates that a value is a string suitable for parsing.
 *
 * This function performs defensive runtime checks on external input before it
 * reaches the parser. It guards against:
 * - Non-string types (including null, undefined, objects, arrays)
 * - Excessively large strings that could cause memory exhaustion
 * - Empty strings (when configured to disallow them)
 *
 * @param value - The value to validate (typically from untrusted external sources).
 * @param options - Optional validation configuration.
 * @returns The validated string when all checks pass.
 * @throws {SourceTextValidationError} When validation fails, with a message
 *   describing the specific violation.
 *
 * @example
 * ```typescript
 * // Validate basic input
 * const source = validateSourceText(userInput);
 *
 * // Enforce stricter limits
 * const source = validateSourceText(userInput, {
 *   maxLength: 1024 * 1024, // 1MB limit
 *   allowEmpty: false
 * });
 * ```
 */
export function validateSourceText(value: unknown, options: SourceTextValidationOptions = {}): string {
    const { maxLength = DEFAULT_MAX_SOURCE_LENGTH, allowEmpty = true } = options;

    if (value === null) {
        throw new SourceTextValidationError(
            "Source text cannot be null. Provide a string or empty string if no source is available."
        );
    }

    if (value === undefined) {
        throw new SourceTextValidationError(
            "Source text cannot be undefined. Provide a string or empty string if no source is available."
        );
    }

    if (typeof value !== "string") {
        const actualType = Array.isArray(value) ? "array" : typeof value;
        throw new SourceTextValidationError(`Source text must be a string, received ${actualType}.`);
    }

    if (!allowEmpty && value.length === 0) {
        throw new SourceTextValidationError("Source text cannot be empty when allowEmpty is false.");
    }

    if (value.length > maxLength) {
        throw new SourceTextValidationError(
            `Source text exceeds maximum allowed length of ${maxLength} characters (received ${value.length} characters).`
        );
    }

    return value;
}

/**
 * Type guard to check if a value is a valid non-null string.
 *
 * Unlike {@link validateSourceText}, this function returns a boolean instead
 * of throwing, making it suitable for conditional logic where errors should
 * not interrupt control flow.
 *
 * @param value - The value to check.
 * @returns True if value is a string (including empty strings), false otherwise.
 *
 * @example
 * ```typescript
 * if (isValidSourceTextType(input)) {
 *   // TypeScript now knows `input` is a string
 *   const parsed = parse(input);
 * }
 * ```
 */
export function isValidSourceTextType(value: unknown): value is string {
    return typeof value === "string";
}
