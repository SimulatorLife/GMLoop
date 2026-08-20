import { assertFunction, isObjectLike } from "./object.js";
import { assertNonEmptyString } from "./string.js";

type ApplyEnvironmentOverrideParams = {
    env?: NodeJS.ProcessEnv | null;
    envVar?: string | null;
    applyValue?: (value: string | undefined) => void;
    includeUndefined?: boolean;
};

type EnvConfiguredValueParams<TValue> = {
    defaultValue: TValue;
    envVar?: string | null;
    normalize?: (raw: unknown, context: { defaultValue: TValue; previousValue: TValue }) => TValue;
    applyOverride?: (params: ApplyEnvironmentOverrideParams) => void;
};

type EnvConfiguredValueWithFallbackParams<TValue> = {
    defaultValue: TValue;
    envVar?: string | null;
    resolve?: (
        raw: unknown,
        context: {
            defaultValue: TValue;
            previousValue: TValue;
            fallback: TValue;
        }
    ) => TValue | null | undefined;
    computeFallback?: (context: { defaultValue: TValue; previousValue: TValue }) => TValue;
};

/**
 * Apply an environment-driven override by invoking {@link applyValue} when the
 * referenced variable is defined.
 *
 * Centralizes the defensive plumbing shared by CLI utilities and the project
 * index so future overrides can opt into consistent validation and fallback
 * behaviour without repeating boilerplate guards.
 *
 * @param {object} parameters
 * @param {NodeJS.ProcessEnv | null | undefined} [parameters.env] Environment
 *        map to read from. Defaults to {@link process.env} when omitted.
 * @param {string} parameters.envVar Name of the environment variable powering
 *        the override.
 * @param {(value: string) => void} parameters.applyValue Callback invoked with
 *        the environment value when present.
 * @param {boolean} [parameters.includeUndefined=false] When `true`, invoke the
 *        callback even if the variable is explicitly set to `undefined`.
 */
export function applyEnvironmentOverride({
    env,
    envVar,
    applyValue,
    includeUndefined = false
}: ApplyEnvironmentOverrideParams = {}) {
    const variable = assertNonEmptyString(envVar, {
        name: "envVar",
        trim: true
    });
    assertFunction(applyValue, "applyValue");

    const sourceEnv = resolveEnvironmentMap(env);

    if (!sourceEnv) {
        return;
    }

    const rawValue = sourceEnv[variable];

    if (rawValue === undefined && !includeUndefined) {
        return;
    }

    applyValue(rawValue);
}

/**
 * Normalize a candidate environment map into a plain object reference.
 *
 * The helper mirrors the defensive guards used by the other environment
 * utilities so callers can accept optional overrides without sprinkling
 * `process.env` checks or trusting non-object values. When a usable map is not
 * supplied it falls back to {@link process.env} when available, otherwise
 * returns `null` so consumers can gracefully skip environment-driven logic.
 *
 * @param {NodeJS.ProcessEnv | null | undefined | unknown} candidate Potential
 *        environment source provided by the caller.
 * @returns {NodeJS.ProcessEnv | null} Normalized environment map or `null`
 *          when neither the candidate nor {@link process.env} is usable.
 */
export function resolveEnvironmentMap(candidate) {
    if (isObjectLike(candidate)) {
        return candidate;
    }

    if (isObjectLike(process?.env)) {
        return process.env;
    }

    return null;
}

/**
 * Apply an environment override after normalizing the provided environment map.
 *
 * Shared configuration modules often accept optional `env` overrides so tests
 * can simulate distinct process environments. Centralizing the
 * `resolveEnvironmentMap`/nullish fallback pattern keeps each module focused on
 * its domain logic while ensuring we consistently guard against non-object
 * inputs.
 *
 * @template {{ applyEnvOverride: (env?: NodeJS.ProcessEnv | undefined) => any }} TConfig
 * @param {TConfig | null | undefined} config Configured value wrapper exposing
 *        an `applyEnvOverride` method.
 * @param {NodeJS.ProcessEnv | null | undefined | unknown} env Candidate
 *        environment override supplied by the caller.
 * @returns {ReturnType<TConfig["applyEnvOverride"]>} Result of invoking
 *          `config.applyEnvOverride` with the normalized environment map.
 */
export function applyConfiguredValueEnvOverride(config, env) {
    const applyOverride = assertFunction(config?.applyEnvOverride, "config.applyEnvOverride");

    const sourceEnv = resolveEnvironmentMap(env);
    if (!sourceEnv) {
        return applyOverride.call(config);
    }

    return applyOverride.call(config, sourceEnv);
}

/**
 * Create a stateful value that can be configured imperatively and via
 * environment overrides.
 *
 * The helper centralizes the common pattern of tracking a configurable
 * default, exposing getters/setters, and wiring an environment variable that
 * drives the fallback. Callers provide a {@link normalize} function responsible
 * for validating incoming values and returning the updated state. The function
 * receives the raw value along with the baseline default and the previous
 * configured value so normalization logic can make context-aware decisions
 * without closing over module-level variables.
 *
 * @template TValue
 * @param {object} parameters
 * @param {TValue} parameters.defaultValue Baseline value returned before any
 *        overrides are applied.
 * @param {string | null | undefined} [parameters.envVar] Environment variable
 *        that triggers the override when defined. When omitted we intentionally
 *        skip the environment plumbing so {@link applyEnvOverride} simply
 *        returns the in-memory value. This keeps callers that do not expose an
 *        env toggle (for example, tests or programmatic embeds) from
 *        accidentally reading `process.env` or mutating the state, which would
 *        blur the boundary between runtime configuration and defaults.
 * @param {(raw: unknown, context: {
 *     defaultValue: TValue;
 *     previousValue: TValue;
 * }) => TValue} parameters.normalize Function that validates the new value and
 *        returns the configured result.
 * @param {typeof applyEnvironmentOverride} [parameters.applyOverride]
 *        Override for the environment override helper, primarily used in
 *        testing.
 * @returns {{
 *     get(): TValue;
 *     set(value: unknown): TValue;
 *     applyEnvOverride(env?: NodeJS.ProcessEnv | null | undefined): TValue;
 * }} Utility methods for interacting with the configurable value.
 */
export function createEnvConfiguredValue<TValue>(
    {
        defaultValue,
        envVar,
        normalize,
        applyOverride = applyEnvironmentOverride
    }: EnvConfiguredValueParams<TValue> = {} as EnvConfiguredValueParams<TValue>
) {
    assertFunction(normalize, "normalize");

    let currentValue = defaultValue;

    const set = (value) => {
        currentValue = normalize(value, {
            defaultValue,
            previousValue: currentValue
        });

        return currentValue;
    };

    const get = () => currentValue;

    const applyEnvOverride = envVar
        ? (env) => {
              applyOverride({ env, envVar, applyValue: set });
              return currentValue;
          }
        : () => currentValue;

    return { get, set, applyEnvOverride };
}

/**
 * Wrap {@link createEnvConfiguredValue} so callers can provide normalization
 * logic that gracefully falls back to the previous or default value when
 * coercion fails. This centralizes the "try, catch, and fallback" pattern used
 * by CLI and project index modules when parsing environment overrides into a
 * reusable helper.
 *
 * @template TValue
 * @param {object} parameters
 * @param {TValue} parameters.defaultValue Baseline value exposed before any
 *        overrides are applied.
 * @param {string | null | undefined} [parameters.envVar] Environment variable
 *        powering the override. When omitted the helper mirrors the behaviour
 *        of {@link createEnvConfiguredValue} and simply returns the in-memory
 *        value.
 * @param {(raw: unknown, context: {
 *     defaultValue: TValue;
 *     previousValue: TValue;
 *     fallback: TValue;
 * }) => TValue | null | undefined} parameters.resolve Function that normalizes
 *        the raw value. Returning `null` or `undefined` triggers the fallback.
 * @param {(context: { defaultValue: TValue; previousValue: TValue }) => TValue}
 *        [parameters.computeFallback] Optional factory used to derive the
 *        fallback value. Defaults to using the previous value when available,
 *        otherwise the configured default.
 * @returns {{
 *     get(): TValue;
 *     set(value: unknown): TValue;
 *     applyEnvOverride(env?: NodeJS.ProcessEnv | null | undefined): TValue;
 * }}
 */
export function createEnvConfiguredValueWithFallback<TValue>(
    {
        defaultValue,
        envVar,
        resolve,
        computeFallback
    }: EnvConfiguredValueWithFallbackParams<TValue> = {} as EnvConfiguredValueWithFallbackParams<TValue>
) {
    assertFunction(resolve, "resolve");

    const fallbackFactory =
        typeof computeFallback === "function"
            ? computeFallback
            : ({ defaultValue: configuredDefaultValue, previousValue }) => previousValue ?? configuredDefaultValue;

    return createEnvConfiguredValue({
        defaultValue,
        envVar,
        normalize: (rawValue, context) => {
            const fallback = fallbackFactory(context);

            try {
                const resolved = resolve(rawValue, {
                    ...context,
                    fallback
                });

                if (resolved !== null && resolved !== undefined) {
                    return resolved;
                }
            } catch {
                // Fall back below when resolution throws.
            }

            return fallback;
        }
    });
}
