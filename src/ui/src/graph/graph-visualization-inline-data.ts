function escapeHtmlText(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function renderGraphVisualizationDocumentTitle(title: string): string {
    return escapeHtmlText(title);
}

/**
 * Serialize bootstrap payload data for an inline script assignment without allowing HTML/script breakouts.
 */
export function serializeGraphVisualizationJsonForInlineScript(value: unknown): string {
    return JSON.stringify(value)
        .replaceAll("<", String.raw`\u003c`)
        .replaceAll(">", String.raw`\u003e`)
        .replaceAll("&", String.raw`\u0026`)
        .replaceAll("\u2028", String.raw`\u2028`)
        .replaceAll("\u2029", String.raw`\u2029`);
}
