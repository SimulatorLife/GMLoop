/**
 * Return a stable user-facing error message for UI-owned async failures.
 */
export function getUiErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }

    if (typeof error === "string" && error.trim().length > 0) {
        return error;
    }

    return fallback;
}
