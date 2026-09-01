import path from "node:path";

/** Normalize a semantic fact path to its project-relative persistent key. */
export function normalizeSemanticFilePath(projectRoot: string, filePath: string): string {
    const relativePath = path.isAbsolute(filePath) ? path.relative(projectRoot, filePath) : filePath;
    return path.normalize(relativePath).split(path.sep).join("/").replaceAll("\\", "/");
}
