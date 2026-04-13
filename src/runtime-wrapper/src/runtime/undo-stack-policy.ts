/**
 * Trim the oldest entries from {@link array} so its length does not exceed
 * {@link maxSize}.  A non-positive {@link maxSize} is treated as unbounded
 * (no trimming).  This replaces the former `evaluateUndoStackTrimPolicy`
 * decision-object pattern with a direct mutation, since every caller
 * immediately spliced the array after inspecting the decision anyway.
 */
export function trimArrayToMaxSize<T>(array: Array<T>, maxSize: number): void {
    if (maxSize <= 0 || array.length <= maxSize) {
        return;
    }

    array.splice(0, array.length - maxSize);
}
