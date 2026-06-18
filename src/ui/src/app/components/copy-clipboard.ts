/**
 * Write a string to the system clipboard.
 *
 * Uses the asynchronous Clipboard API when available and falls back to a
 * hidden textarea + `document.execCommand("copy")` for browsers or
 * non-secure-context test environments that do not expose `navigator.clipboard`.
 * The fallback is intentionally synchronous because `execCommand` does not
 * return a promise; callers in the UI wait on the returned boolean either way.
 *
 * @param value - The text to write to the clipboard.
 * @returns `true` when the clipboard now contains `value`, `false` otherwise.
 */
export async function writeValueToClipboard(value: string): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            // Fall through to the legacy fallback below.
        }
    }

    return writeValueToClipboardLegacy(value);
}

/**
 * Legacy copy path that uses a hidden textarea + `document.execCommand("copy")`.
 *
 * Kept separate from {@link writeValueToClipboard} so tests can target the
 * fallback in isolation without having to mock the async Clipboard API.
 *
 * @param value - The text to write through the legacy copy command.
 * @returns `true` when `document.execCommand("copy")` reports success.
 */
export function writeValueToClipboardLegacy(value: string): boolean {
    if (typeof document === "undefined") {
        return false;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.append(textarea);
    textarea.select();
    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
}
