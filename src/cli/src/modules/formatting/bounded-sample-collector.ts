/**
 * Utilities for collecting samples up to a configurable limit with deduplication.
 *
 * These helpers extract the low-level array manipulation and boundary checking
 * from higher-level orchestration code, keeping the recording logic focused on
 * business concerns rather than primitive bookkeeping.
 */

import { Core } from "@gmloop/core";

/**
 * Add a sample to a collection if the limit hasn't been reached and it's not already present.
 *
 * Delegates deduplication to {@link Core.pushUnique} while adding capacity-aware
 * boundary checking so callers can enforce collection size limits without
 * repeating the guard logic.
 *
 * @template T
 * @param {T[]} samples - The array to add the sample to
 * @param {T} sample - The sample to add
 * @param {number} limit - Maximum number of samples to collect
 * @param {(existing: T, candidate: T) => boolean} [isEqual] - Optional equality check
 * @returns {boolean} True if the sample was added, false otherwise
 */
export function tryAddSample<T>(
    samples: Array<T>,
    sample: T,
    limit: number,
    isEqual?: (existing: T, candidate: T) => boolean
): boolean {
    if (limit <= 0 || samples.length >= limit) {
        return false;
    }

    return Core.pushUnique(samples, sample, { isEqual });
}
