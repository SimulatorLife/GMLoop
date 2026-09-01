/**
 * @gmloop/runtime-wrapper — Patch Queue Admission Policy
 *
 * ## Separation of concerns
 *
 * The patch queue mechanism functions (`enqueuePendingPatchUntilRuntimeReady`,
 * `enqueuePatchForDeferredFlush`) live in `patch-queue.ts` and own all the
 * side effects: mutating the queue array, advancing the head cursor, and
 * updating metrics. Those callers previously inlined the admission rules
 * alongside those mutations, making it impossible to exercise the rules in
 * isolation without a real `WebSocketClientState`.
 *
 * This module holds only the **policy** — pure functions that decide, given
 * the queue's current shape and a configured capacity, what an admission
 * attempt should do next:
 *
 *   - whether the queue is already at capacity and must drop its oldest entry
 *   - whether the head cursor has drifted far enough that the underlying
 *     array should be compacted (a `slice` reset to clear consumed entries)
 *
 * The evaluator returns a discriminated `PatchQueueAdmissionDecision` value
 * describing the action; the mechanism performs the action. Because the
 * policy is pure it can be unit-tested without spinning up a websocket or a
 * runtime wrapper, and because the mechanism depends on the policy
 * evaluator rather than recomputing the threshold formulas inline, the
 * rules can evolve in a single, well-named location.
 */

/**
 * Multiplier applied to the configured queue ceiling to decide when the head
 * cursor has drifted far enough to justify compacting the underlying array.
 *
 * The previous inline implementation in `patch-queue.ts` chose `2` because the
 * queue only needs to grow the underlying buffer to roughly twice the
 * configured ceiling before the consumed prefix becomes worth reclaiming.
 * Lower values trade extra `slice` work for lower peak memory; higher values
 * keep the array large but reduce compaction frequency. `2` matches the
 * conservative growth factor historically used and remains the only knob the
 * policy exposes.
 */
export const PATCH_QUEUE_COMPACTION_THRESHOLD_MULTIPLIER = 2;

/**
 * Inputs required to evaluate the patch queue admission policy.
 */
export type PatchQueueAdmissionInput = {
    /**
     * The number of live (unconsumed) entries currently in the queue, i.e.
     * `queue.length - queueHead`. The policy treats this as the "depth" it
     * compares against the capacity.
     */
    readonly effectiveSize: number;
    /**
     * The current head cursor. After a drop the cursor advances by one;
     * after a compaction it resets to `0`. The policy uses this both to
     * detect "drift" (entries consumed but not yet reclaimed) and to report
     * the next cursor value.
     */
    readonly headIndex: number;
    /**
     * The maximum number of live entries the queue is allowed to retain.
     * The previous inline implementation required `>= 1`; the policy assumes
     * callers have already validated that constraint.
     */
    readonly maxSize: number;
};

/**
 * Outcome returned by {@link evaluatePatchQueueAdmission}.
 *
 * The discriminator makes every branch's required data explicit so the
 * mechanism cannot accidentally read `newHeadIndex` on a "admit" decision
 * or omit compaction when the policy says to perform it.
 */
export type PatchQueueAdmissionDecision =
    | {
          /**
           * `admit` means the live queue depth is strictly below capacity,
           * so the incoming patch can be appended without dropping anything.
           * The mechanism should append the patch and leave the cursor
           * unchanged.
           */
          readonly action: "admit";
      }
    | {
          /**
           * `drop-oldest` means the queue is at or above capacity, so the
           * incoming patch can only be admitted by evicting the current
           * oldest live entry. The mechanism must:
           *
           *   1. Increment the queue's "dropped" metric by one.
           *   2. Advance the head cursor to `newHeadIndex`.
           *   3. Append the incoming patch.
           *
           * The `compactUnderlyingArray` flag tells the mechanism whether
           * the policy also wants the consumed prefix reclaimed.
           */
          readonly action: "drop-oldest";
          readonly newHeadIndex: number;
          readonly compactUnderlyingArray: boolean;
      };

/**
 * Evaluate the patch queue admission decision in isolation.
 *
 * The policy is intentionally small: it answers one question — "given the
 * queue's current depth and cursor, what does the next admission attempt
 * require?" — and returns enough information for the mechanism to apply the
 * answer without re-reading the same inputs.
 *
 * Behavioural notes:
 *
 *   - `effectiveSize >= maxSize` triggers an eviction. The cursor advances
 *     by one to skip the current oldest live entry.
 *   - Compaction only triggers when the cursor itself has reached
 *     `maxSize * PATCH_QUEUE_COMPACTION_THRESHOLD_MULTIPLIER`. The cursor
 *     always advances before the compaction check, so the post-eviction
 *     cursor value is what the policy compares against the threshold; this
 *     keeps "drop" and "compact" decisions synchronized.
 *   - Compaction is reported as `true` exactly when the policy would have
 *     the mechanism call `slice(newHeadIndex)` and reset the cursor to
 *     `0`. The mechanism still owns the actual array assignment.
 *
 * @param input - The current queue shape and configured ceiling.
 * @returns A discriminated decision describing the required admission action.
 */
export function evaluatePatchQueueAdmission(input: PatchQueueAdmissionInput): PatchQueueAdmissionDecision {
    const { effectiveSize, headIndex, maxSize } = input;

    if (effectiveSize < maxSize) {
        return { action: "admit" };
    }

    const newHeadIndex = headIndex + 1;
    const compactionThreshold = maxSize * PATCH_QUEUE_COMPACTION_THRESHOLD_MULTIPLIER;
    const compactUnderlyingArray = newHeadIndex >= compactionThreshold;

    return {
        action: "drop-oldest",
        newHeadIndex,
        compactUnderlyingArray
    };
}
