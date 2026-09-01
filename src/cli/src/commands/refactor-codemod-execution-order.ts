import type { Refactor } from "@gmloop/refactor";

type RegisteredCodemodId = ReturnType<typeof Refactor.listRegisteredCodemods>[number]["id"];

/**
 * Create an ordered tracker for codemod completion callbacks.
 *
 * Completion must follow the configured order. The tracker consumes each
 * completed codemod and exposes only the next codemod needed by the caller.
 */
export function createCodemodExecutionOrderTracker(selectedCodemodIds: ReadonlyArray<RegisteredCodemodId>) {
    const remainingCodemodIds = [...selectedCodemodIds];

    return {
        consumeCompletedCodemod(codemodId: RegisteredCodemodId): void {
            const expectedCodemodId = remainingCodemodIds.shift();
            if (expectedCodemodId !== codemodId) {
                throw new Error(
                    `Configured codemod execution order drifted while refreshing semantic index (expected ${expectedCodemodId ?? "<none>"}, received ${codemodId}).`
                );
            }
        },
        nextCodemodId(): RegisteredCodemodId | undefined {
            return remainingCodemodIds[0];
        }
    };
}
