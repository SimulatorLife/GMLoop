import { parentPort } from "node:worker_threads";

import { Core, type FsFacade } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";

import { normalizeWorkerErrorPayload } from "./error-normalization.js";

type OpenDocumentOverlay = Readonly<{
    contentHash: string;
    documentVersion: number;
    filePath: string;
    sourceText: string;
}>;

type WorkerSemanticFileChange = Readonly<{
    filePath: string;
    kind: "added" | "deleted" | "metadataChanged" | "modified";
}>;

type WorkerRequest = Readonly<{
    definitionsOnly: boolean;
    incremental: Readonly<{
        changes: ReadonlyArray<WorkerSemanticFileChange>;
        existingIndex: Record<string, unknown>;
    }> | null;
    openDocuments: ReadonlyArray<OpenDocumentOverlay>;
    priorityFiles: ReadonlyArray<string>;
    projectRoot: string;
}>;

function createWorkerFsFacade(openDocuments: ReadonlyArray<OpenDocumentOverlay>): FsFacade {
    const sourceTextByPath = new Map(openDocuments.map((document) => [document.filePath, document.sourceText]));
    return {
        ...Core.defaultFsFacade,
        async readFile(filePath, encoding) {
            return sourceTextByPath.get(filePath) ?? (await Core.defaultFsFacade.readFile(filePath, encoding));
        }
    };
}

if (parentPort === null) {
    throw new Error("Project index worker requires a parent thread.");
}

parentPort.on("message", (request: WorkerRequest) => {
    void buildWorkerIndex(request);
});

async function buildWorkerIndex(request: WorkerRequest): Promise<void> {
    try {
        const rawIndex = await Semantic.buildProjectIndex(
            request.projectRoot,
            createWorkerFsFacade(request.openDocuments),
            {
                definitionsOnly: request.definitionsOnly,
                incremental: request.incremental ?? undefined,
                priorityFiles: request.priorityFiles
            }
        );
        const semanticSnapshot = Semantic.createSemanticSnapshotFromProjectIndex(
            rawIndex,
            request.definitionsOnly ? "definitions" : "full",
            "" as Parameters<typeof Semantic.createSemanticSnapshotFromProjectIndex>[2]
        );
        parentPort?.postMessage({
            openDocumentBoundary: request.openDocuments.map((document) => ({
                contentHash: document.contentHash,
                documentVersion: document.documentVersion,
                filePath: document.filePath
            })),
            rawIndex,
            semanticSnapshot
        });
    } catch (error) {
        parentPort?.postMessage({ error: normalizeWorkerErrorPayload(error) });
    }
}
