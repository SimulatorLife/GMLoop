import { Core } from "@gmloop/core";

/**
 * Assert that a config segment is a plain object and provide a context-aware error message.
 */
export function assertRefactorConfigPlainObject(value: unknown, context: string): Record<string, unknown> {
    return Core.assertPlainObject(value, {
        errorMessage: `${context} must be a plain object`
    });
}

/**
 * Assert that a config segment is a plain object whose keys are all members of
 * `allowedKeys`. Throws a TypeError naming the first unexpected key, keeping
 * error messages consistent across every config-parsing call site.
 */
export function assertRefactorConfigPlainObjectWithAllowedKeys(
    value: unknown,
    allowedKeys: ReadonlySet<string>,
    context: string
): Record<string, unknown> {
    const object = assertRefactorConfigPlainObject(value, context);
    for (const key of Object.keys(object)) {
        if (!allowedKeys.has(key)) {
            throw new TypeError(`${context} contains unknown property ${JSON.stringify(key)}`);
        }
    }
    return object;
}
