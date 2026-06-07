import assert from "node:assert/strict";

function normalizeWhitespace(value: string): string {
    return value.replaceAll(/\s+/gu, "");
}

function normalizeWhitespaceAndLineEndings(value: string): string {
    return normalizeWhitespace(normalizeLineEndings(value));
}

function normalizeLineEndings(value: string): string {
    return value.replaceAll(/\r\n?/gu, "\n");
}

function buildAssertionMessage(defaultMessage: string, message?: string): string {
    if (!message || message.length === 0) {
        return defaultMessage;
    }

    return `${message}\n${defaultMessage}`;
}

/**
 * Asserts equality while treating whitespace/newline-only differences in strings as equal.
 */
export function assertEquals(actual: unknown, expected: unknown, message?: string): void {
    if (typeof actual === "string" && typeof expected === "string") {
        const normalizedActual = normalizeWhitespaceAndLineEndings(actual);
        const normalizedExpected = normalizeWhitespaceAndLineEndings(expected);
        if (normalizedActual === normalizedExpected) {
            return;
        }

        throw new assert.AssertionError({
            actual: normalizeLineEndings(actual),
            expected: normalizeLineEndings(expected),
            operator: "assertEquals(normalized)",
            message: buildAssertionMessage(
                "Expected values to be equal after whitespace/newline normalization.",
                message
            ),
            stackStartFn: assertEquals
        });

        return;
    }

    assert.equal(actual, expected, message);
}

/**
 * Asserts inequality while treating whitespace/newline-only differences in strings as equal.
 */
export function assertNotEquals(actual: unknown, expected: unknown, message?: string): void {
    if (typeof actual === "string" && typeof expected === "string") {
        const normalizedActual = normalizeWhitespaceAndLineEndings(actual);
        const normalizedExpected = normalizeWhitespaceAndLineEndings(expected);
        if (normalizedActual !== normalizedExpected) {
            return;
        }

        throw new assert.AssertionError({
            actual: normalizeLineEndings(actual),
            expected: normalizeLineEndings(expected),
            operator: "assertNotEquals(normalized)",
            message: buildAssertionMessage(
                "Expected values to be different after whitespace/newline normalization.",
                message
            ),
            stackStartFn: assertNotEquals
        });

        return;
    }

    assert.notEqual(actual, expected, message);
}
