/**
 * Callback invoked for each value during sequential iteration.
 * @template T The type of values being processed
 */
export type SequentialCallback<T> = (value: T, index: number) => void | Promise<void>;

/**
 * Executes an async callback sequentially for each value in an iterable.
 * Guarantees that callbacks complete in order before the next one starts.
 *
 * @template T The type of values being processed
 * @param values The iterable collection to process
 * @param task The async function to invoke for each value
 * @returns A promise that resolves when all callbacks complete
 *
 * @example
 * await runSequentially([1, 2, 3], async (num, index) => {
 *   console.log(`Processing ${num} at index ${index}`);
 * });
 */
export async function runSequentially<T>(values: Iterable<T>, task: SequentialCallback<T>): Promise<void> {
    let chain: Promise<unknown> = Promise.resolve();
    let index = 0;

    for (const value of values) {
        // `value` is block-scoped per for...of iteration, but `index` is not — capture
        // the current iteration's index before incrementing so each closure sees its own.
        const currentIndex = index++;
        chain = chain.then(() => task(value, currentIndex));
    }

    await chain;
}

/**
 * Callback invoked for each value during parallel iteration.
 * @template T The type of values being processed
 * @template R The type of result returned by the callback
 */
export type ParallelCallback<T, R> = (value: T, index: number) => R | Promise<R>;

/**
 * Executes an async callback in parallel for each value in an iterable.
 * All callbacks run concurrently and the function waits for all to complete.
 *
 * @template T The type of values being processed
 * @template R The type of result returned by the callback
 * @param values The iterable collection to process
 * @param callback The async function to invoke for each value
 * @returns A promise that resolves with an array of all results when all callbacks complete
 *
 * @example
 * const results = await runInParallel([1, 2, 3], async (num, index) => {
 *   return num * 2;
 * });
 * // results = [2, 4, 6]
 */
export function runInParallel<T, R>(values: Iterable<T>, callback: ParallelCallback<T, R>): Promise<Array<R>> {
    const entries = Array.from(values);
    const promises = entries.map((value, index) => callback(value, index));
    return Promise.all(promises);
}

/**
 * Executes an async callback in parallel for each value in an iterable with bounded concurrency.
 * Limits the number of concurrent operations to avoid resource exhaustion while maintaining parallelism.
 *
 * @template T The type of values being processed
 * @template R The type of result returned by the callback
 * @param values The iterable collection to process
 * @param callback The async function to invoke for each value
 * @param limit Maximum number of concurrent operations (must be >= 1)
 * @returns A promise that resolves with an array of all results when all callbacks complete
 *
 * @example
 * // Process directories with max 4 concurrent operations
 * const results = await runInParallelWithLimit(directories, async (dir) => {
 *   return await processDirectory(dir);
 * }, 4);
 */
export async function runInParallelWithLimit<T, R>(
    values: Iterable<T>,
    callback: ParallelCallback<T, R>,
    limit: number
): Promise<Array<R>> {
    const entries = Array.from(values);

    if (limit <= 0) {
        throw new Error("Concurrency limit must be at least 1");
    }

    if (entries.length === 0) {
        return [];
    }

    // Pre-allocate array to preserve result order. When errors occur, Promise.all
    // will reject immediately, so partial results won't be returned to the caller.
    const results: Array<R> = Array.from({ length: entries.length });
    let currentIndex = 0;

    // Worker function pulls items from the shared queue and processes them recursively.
    // Each worker continuously processes items until the queue is exhausted, enabling
    // controlled concurrency without await-in-loop patterns.
    const processNext = async (): Promise<void> => {
        const indexToProcess = currentIndex;
        currentIndex += 1;

        if (indexToProcess >= entries.length) {
            return;
        }

        results[indexToProcess] = await callback(entries[indexToProcess], indexToProcess);

        // Process the next item from the shared queue
        await processNext();
    };

    const workers = Array.from({ length: Math.min(limit, entries.length) }, () => processNext());
    await Promise.all(workers);

    return results;
}
