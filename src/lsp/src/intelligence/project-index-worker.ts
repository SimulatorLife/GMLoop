import { parentPort } from "node:worker_threads";

import { Semantic } from "@gmloop/semantic";

type WorkerRequest = Readonly<{
    definitionsOnly: boolean;
    priorityFiles: ReadonlyArray<string>;
    projectRoot: string;
}>;

if (parentPort === null) {
    throw new Error("Project index worker requires a parent thread.");
}

parentPort.on("message", (request: WorkerRequest) => {
    void buildWorkerIndex(request);
});

async function buildWorkerIndex(request: WorkerRequest): Promise<void> {
    try {
        const index = await Semantic.buildProjectNavigationIndex(request.projectRoot, undefined, {
            definitionsOnly: request.definitionsOnly,
            priorityFiles: request.priorityFiles
        });
        parentPort?.postMessage({ rawIndex: index.rawIndex });
    } catch (error) {
        parentPort?.postMessage({
            error:
                error instanceof Error
                    ? { message: error.message, name: error.name, stack: error.stack }
                    : String(error)
        });
    }
}
