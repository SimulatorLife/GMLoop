import { Core } from "@gmloop/core";

const { assertNonEmptyString, getErrorMessage, isErrorWithCode, isObjectOrFunction } = Core;

type ModuleWithDefault<TValue> = TValue & {
    default?: unknown;
};

type ModuleDefaultExport<TValue> = TValue extends {
    default?: infer TDefault;
}
    ? TValue | TDefault
    : TValue;

/**
 * Normalize dynamically imported modules to their default export when
 * available. Centralizes the optional chaining scattered across CLI entry
 * points so CJS and ESM interop semantics stay aligned. Callers receive the
 * original namespace object when the module lacks a default export or when the
 * export is intentionally null/undefined.
 *
 * @template TModule
 * @param module Namespace object returned from a dynamic import.
 * @returns The module's default export when populated, otherwise the original
 *          module reference.
 */
export function resolveModuleDefaultExport<TModule>(module?: TModule): ModuleDefaultExport<TModule> {
    if (module == null || !isObjectOrFunction(module)) {
        return module as ModuleDefaultExport<TModule>;
    }

    const { default: defaultExport } = module as ModuleWithDefault<TModule>;
    return (defaultExport ?? module) as ModuleDefaultExport<TModule>;
}

/**
 * Determine whether an error corresponds to a missing module dependency for
 * {@link moduleId}. Centralizes the defensive guard shared by dynamic import
 * call sites so fallback behaviour stays consistent across the CLI.
 *
 * @param error Value thrown from a dynamic import.
 * @param moduleId Module identifier expected in the error message.
 * @returns `true` when the error matches the missing module.
 */
export function isMissingModuleDependency(error: unknown, moduleId: string): boolean {
    if (!isErrorWithCode(error, "ERR_MODULE_NOT_FOUND")) {
        return false;
    }

    const normalizedModuleId = assertNonEmptyString(moduleId, {
        name: "moduleId",
        trim: true
    });

    const message = getErrorMessage(error, { fallback: "" });
    if (message.length === 0) {
        return false;
    }

    const quotedIdentifiers = [`'${normalizedModuleId}'`, `"${normalizedModuleId}"`];

    return quotedIdentifiers.some((identifier) => message.includes(identifier));
}
