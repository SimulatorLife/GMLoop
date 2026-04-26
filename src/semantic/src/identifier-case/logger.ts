import { Core } from "@gmloop/core";

const DEFAULT_WARNING_FALLBACK = "Unknown error";

type WarningLogger = Readonly<{
    warn?: (message: string) => void;
}>;

function resolveWarningReason(
    warningCandidates: ReadonlyArray<unknown>,
    fallbackMessage: string = DEFAULT_WARNING_FALLBACK
): string {
    const pendingCandidates: Array<unknown> = [];
    for (let index = warningCandidates.length - 1; index >= 0; index -= 1) {
        pendingCandidates.push(warningCandidates[index]);
    }

    while (pendingCandidates.length > 0) {
        const warningCandidate = pendingCandidates.pop();

        if (Array.isArray(warningCandidate)) {
            for (let index = warningCandidate.length - 1; index >= 0; index -= 1) {
                pendingCandidates.push(warningCandidate[index]);
            }
            continue;
        }

        const reason = Core.getErrorMessage(warningCandidate, { fallback: "" });
        if (reason.length > 0) {
            return reason;
        }
    }

    return fallbackMessage;
}

export function warnWithReason(
    logger: WarningLogger | null | undefined,
    namespace: string,
    message: string,
    ...warningCandidates: ReadonlyArray<unknown>
): void {
    if (typeof logger?.warn !== "function") {
        return;
    }

    const reason = resolveWarningReason(warningCandidates);
    const suffix = reason.length > 0 ? `: ${reason}` : "";

    logger.warn(`[${namespace}] ${message}${suffix}`);
}
