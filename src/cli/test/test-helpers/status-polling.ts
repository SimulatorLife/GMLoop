export type StatusPayload = {
    patchCount?: number;
    patchHistorySize?: number;
    maxPatchHistory?: number;
    totalPatchCount?: number;
    errorCount?: number;
    scanComplete?: boolean;
    avgHotReloadLatencyMs?: number;
    p95HotReloadLatencyMs?: number;
    recentPatches?: Array<{
        id: string;
        timestamp: number;
        durationMs: number;
        filePath: string;
        hotReloadLatencyMs?: number;
    }>;
};

const DEFAULT_STATUS_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 25;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function extractPatchCount(payload: StatusPayload): number {
    return typeof payload.totalPatchCount === "number"
        ? payload.totalPatchCount
        : typeof payload.patchCount === "number"
          ? payload.patchCount
          : 0;
}

function extractErrorCount(payload: StatusPayload): number {
    return typeof payload.errorCount === "number" ? payload.errorCount : 0;
}

export async function waitForPatchCount(
    baseUrl: string,
    minCount: number,
    timeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<number> {
    const payload = await waitForStatus(
        baseUrl,
        (status) => extractPatchCount(status) >= minCount,
        timeoutMs,
        pollIntervalMs
    );

    return extractPatchCount(payload);
}

export async function waitForErrorCount(
    baseUrl: string,
    minCount: number,
    timeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<number> {
    const payload = await waitForStatus(
        baseUrl,
        (status) => extractErrorCount(status) >= minCount,
        timeoutMs,
        pollIntervalMs
    );

    return extractErrorCount(payload);
}

export async function waitForScanComplete(
    baseUrl: string,
    timeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<void> {
    await waitForStatus(baseUrl, (status) => status.scanComplete === true, timeoutMs, pollIntervalMs);
}

export async function fetchStatusPayload(baseUrl: string): Promise<StatusPayload> {
    const response = await fetch(`${baseUrl}/status`);
    if (!response.ok) {
        throw new Error(`Failed to fetch status from ${baseUrl}/status`);
    }
    return (await response.json()) as StatusPayload;
}

export async function waitForStatusReady(
    baseUrl: string,
    timeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<void> {
    await waitForStatus(baseUrl, () => true, timeoutMs, pollIntervalMs);
}

export async function waitForStatus(
    baseUrl: string,
    predicate: (status: StatusPayload) => boolean,
    timeoutMs = DEFAULT_STATUS_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): Promise<StatusPayload> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/status`);
            if (response.ok) {
                const payload = (await response.json()) as StatusPayload;
                if (predicate(payload)) {
                    return payload;
                }
            }
        } catch {
            // Ignore transient startup failures while the server boots.
        }

        await delay(pollIntervalMs);
    }

    throw new Error("Timed out waiting for watch status update");
}
