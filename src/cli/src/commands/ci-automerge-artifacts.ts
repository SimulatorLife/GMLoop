import fs from "node:fs";
import path from "node:path";

type GitHubOutputValue = string | number | boolean;
type JsonArtifact = null | boolean | number | string | Array<JsonArtifact> | { [key: string]: JsonArtifact };

/** Read and parse a JSON artifact produced by the auto-merge commands. */
export function readAutoMergeJsonArtifact(filePath: string): JsonArtifact {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonArtifact;
}

/** Read an auto-merge JSON artifact, returning `null` when it cannot be read or parsed. */
export function readOptionalAutoMergeJsonArtifact(filePath: string): JsonArtifact {
    try {
        return readAutoMergeJsonArtifact(filePath);
    } catch {
        return null;
    }
}

/** Serialize an auto-merge JSON artifact, creating its parent directory when necessary. */
export function writeAutoMergeJsonArtifact(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Append values using the line-oriented format expected by `GITHUB_OUTPUT`. */
export function appendAutoMergeGitHubOutputs(
    filePath: string | undefined,
    values: Readonly<Record<string, GitHubOutputValue>>
): void {
    if (filePath === undefined) {
        return;
    }

    const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
    fs.appendFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}
