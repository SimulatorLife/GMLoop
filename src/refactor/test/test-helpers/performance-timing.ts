import { performance } from "node:perf_hooks";

/**
 * Measures the median wall-clock duration of an async operation across multiple
 * samples, returning both the timing data and the result from the final sample.
 *
 * Using median rather than mean makes the measurement more robust to
 * transient GC pauses or scheduler jitter in CI environments.
 */
export async function measureMedianDurationMs<T>(
    sampleCount: number,
    execute: () => Promise<T>
): Promise<{
    durationMs: number;
    result: T;
}> {
    const samples = await Promise.all(
        Array.from({ length: sampleCount }, async () => {
            const startTime = performance.now();
            const result = await execute();
            return {
                durationMs: performance.now() - startTime,
                result
            };
        })
    );

    const sortedDurations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const medianSampleIndex = Math.floor(sortedDurations.length / 2);
    const medianDuration = sortedDurations[medianSampleIndex];
    const latestSample = samples.at(-1);

    if (latestSample === undefined || medianDuration === undefined) {
        throw new Error("measureMedianDurationMs requires at least one sample");
    }

    return {
        durationMs: medianDuration,
        result: latestSample.result
    };
}
