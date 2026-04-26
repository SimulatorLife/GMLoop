import type { GraphVisualizationData } from "./types.js";

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

export function serializeGraphVisualizationDataForInlineScript(data: GraphVisualizationData): string {
    return JSON.stringify(data)
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("&", "\\u0026")
        .replaceAll("\u2028", "\\u2028")
        .replaceAll("\u2029", "\\u2029");
}
