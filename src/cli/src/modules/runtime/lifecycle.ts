/**
 * Canonical lifecycle actions accepted by the `runner lifecycle <action>`
 * subcommand.
 *
 * The values are exposed as a frozen object (rather than inlining the string
 * literals in the Commander argument definition, the runtime switch, and the
 * validation error message) so the allowed set is easy to enumerate, share,
 * and evolve from a single source of truth.
 */
export const RUNNER_LIFECYCLE_ACTIONS = Object.freeze({
    start: "start",
    stop: "stop",
    restart: "restart",
    pause: "pause",
    resume: "resume"
} as const);

/**
 * Union type covering every valid `runner lifecycle <action>` value.
 */
export type RunnerLifecycleAction = (typeof RUNNER_LIFECYCLE_ACTIONS)[keyof typeof RUNNER_LIFECYCLE_ACTIONS];

/**
 * Render a comma-separated list of every valid `runner lifecycle <action>`
 * value. Used by {@link coerceRunnerLifecycleAction}'s error message so the
 * allowed set stays in sync with {@link RUNNER_LIFECYCLE_ACTIONS} without
 * duplicating the literal strings.
 */
function listRunnerLifecycleActions(): string {
    return Object.values(RUNNER_LIFECYCLE_ACTIONS).join(", ");
}

const ALLOWED_RUNNER_LIFECYCLE_ACTIONS: ReadonlySet<string> = new Set(Object.values(RUNNER_LIFECYCLE_ACTIONS));

/**
 * Coerce an arbitrary CLI-supplied value into a
 * {@link RunnerLifecycleAction}.
 *
 * Throws a `TypeError` when the value is not a string and an `Error` with a
 * descriptive message when the string does not match one of the canonical
 * lifecycle actions. The CLI layer wraps this function with
 * `wrapInvalidArgumentResolver` so the resulting error becomes a Commander
 * `InvalidArgumentError`, while tests and any other consumers can invoke the
 * raw function directly.
 *
 * @param {unknown} value Raw value supplied by Commander (or a test).
 * @returns {RunnerLifecycleAction} The canonical action string.
 */
export function coerceRunnerLifecycleAction(value: unknown): RunnerLifecycleAction {
    if (typeof value !== "string") {
        throw new TypeError(
            `Invalid lifecycle action: expected a string, received ${value === null ? "null" : typeof value}.`
        );
    }

    const candidate = value.trim();
    if (ALLOWED_RUNNER_LIFECYCLE_ACTIONS.has(candidate)) {
        return candidate as RunnerLifecycleAction;
    }

    throw new Error(`Invalid lifecycle action: "${value}". Allowed values: ${listRunnerLifecycleActions()}.`);
}
