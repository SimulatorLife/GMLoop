/**
 * Source-text read/cache collaborator for {@link GmlSemanticBridge}.
 *
 * Both the occurrence collector and the naming-convention target collector
 * repeatedly need the on-disk (or overlay-provided) text of project files to
 * validate/adjust semantic-index offsets against real source. This class
 * centralizes that file read + in-memory cache so the read strategy (custom
 * `readFile` hook vs. direct filesystem access) lives in exactly one place.
 */

import * as fs from "node:fs";
import path from "node:path";

import { pathExistsSync } from "../../shared/path-exists.js";

export class SemanticBridgeSourceTextCache {
    private readonly sourceTextByPath = new Map<string, string | null>();
    private readFile: ((filePath: string) => Promise<string> | string) | null = null;

    constructor(private readonly projectRoot: string) {}

    setReadFile(readFile: (filePath: string) => Promise<string> | string): void {
        this.readFile = readFile;
    }

    clear(): void {
        this.sourceTextByPath.clear();
    }

    async preload(filePath: string): Promise<void> {
        if (this.sourceTextByPath.has(filePath)) {
            return;
        }

        try {
            const sourceText = this.readFile
                ? await this.readFile(filePath)
                : await fs.promises.readFile(path.resolve(this.projectRoot, filePath), "utf8");
            this.sourceTextByPath.set(filePath, sourceText);
        } catch {
            this.sourceTextByPath.set(filePath, null);
        }
    }

    read(filePath: string): string | null {
        if (this.sourceTextByPath.has(filePath)) {
            return this.sourceTextByPath.get(filePath) ?? null;
        }

        const absolutePath = path.resolve(this.projectRoot, filePath);
        if (!pathExistsSync(absolutePath)) {
            this.sourceTextByPath.set(filePath, null);
            return null;
        }

        try {
            const sourceText = fs.readFileSync(absolutePath, "utf8");
            this.sourceTextByPath.set(filePath, sourceText);
            return sourceText;
        } catch {
            this.sourceTextByPath.set(filePath, null);
            return null;
        }
    }
}
