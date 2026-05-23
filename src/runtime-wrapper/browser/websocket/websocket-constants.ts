/**
 * Default interval (milliseconds) between readiness polls when waiting for the
 * GameMaker runtime to become ready before flushing pending patches.
 *
 * Lower values reduce the delay between runtime readiness and patch application,
 * at the cost of slightly higher CPU usage during the polling window. The default
 * of 50 ms is a reasonable balance for most hot-reload scenarios.
 */
export const DEFAULT_READINESS_POLL_INTERVAL_MS = 50;
