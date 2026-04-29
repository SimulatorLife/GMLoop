import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_FILE_NAMES = Object.freeze({
    css: "graph-visualization-template.css",
    html: "graph-visualization-template.html"
});

function resolveTemplateAssetPath(fileName: string): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const primaryPath = path.resolve(moduleDirectory, "assets", fileName);
    try {
        readFileSync(primaryPath, "utf8");
        return primaryPath;
    } catch {
        return path.resolve(moduleDirectory, "../../../src/graph/assets", fileName);
    }
}

export function readGraphVisualizationTemplateCss(): string {
    return readFileSync(resolveTemplateAssetPath(ASSET_FILE_NAMES.css), "utf8");
}

export function readGraphVisualizationTemplateHtml(): string {
    return readFileSync(resolveTemplateAssetPath(ASSET_FILE_NAMES.html), "utf8");
}
