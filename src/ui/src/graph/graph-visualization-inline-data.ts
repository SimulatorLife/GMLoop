import type { GraphVisualizationData, GraphVisualizationLoadedTarget } from "./types.js";

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
        .replaceAll("<", String.raw`\u003c`)
        .replaceAll(">", String.raw`\u003e`)
        .replaceAll("&", String.raw`\u0026`)
        .replaceAll("\u2028", String.raw`\u2028`)
        .replaceAll("\u2029", String.raw`\u2029`);
}

export function serializeGraphVisualizationLoadedTargetForInlineScript(
    loadedTarget: GraphVisualizationLoadedTarget | null
): string {
    return JSON.stringify(loadedTarget)
        .replaceAll("<", String.raw`\u003c`)
        .replaceAll(">", String.raw`\u003e`)
        .replaceAll("&", String.raw`\u0026`)
        .replaceAll("\u2028", String.raw`\u2028`)
        .replaceAll("\u2029", String.raw`\u2029`);
}
