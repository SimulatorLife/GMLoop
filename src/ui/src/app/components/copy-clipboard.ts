/**
 * Write a string to the system clipboard.
 *
 * Uses the asynchronous Clipboard API, which browsers expose only in supported
 * secure contexts and may reject when clipboard permission is unavailable.
 *
 * @param value - The text to write to the clipboard.
 * @returns `true` when the clipboard now contains `value`, `false` when the API
 * is unavailable or rejects the write.
 */
export async function writeValueToClipboard(value: string): Promise<boolean> {
    if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
        return false;
    }

    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch {
        return false;
    }
}
