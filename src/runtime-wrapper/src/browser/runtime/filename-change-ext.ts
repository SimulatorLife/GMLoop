import { resolveHtml5BuiltinNameMap } from "../support/html5-builtin-discovery.js";

type BrowserGlobalScope = Record<string, unknown>;

const FILENAME_CHANGE_EXT_PATCH_MARKER = "__gmloopFilenameChangeExtSafetyPatched";

const FILENAME_CHANGE_EXT_BUILTIN_NAMES = {
    filename_change_ext: "filename_change_ext"
} as const;

function hasFilenameExtension(filename: string): boolean {
    const lastSeparator = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
    const basename = filename.slice(lastSeparator + 1);
    const lastDot = basename.lastIndexOf(".");
    return lastDot > 0;
}

/**
 * Repairs the HTML5 runtime's `filename_change_ext` behavior for extensionless
 * filenames.
 *
 * GameMaker's documented function replaces an existing extension and adds the
 * requested extension when the filename has none. The HTML5 runtime snapshot
 * only performs the replacement branch, which makes project assets such as
 * `islands/island2.obj` inaccessible when code constructs them from `island2`.
 *
 * @param globalScope - Browser global object containing the HTML5 runtime.
 * @returns True when the runtime function was patched.
 */
export function applyHtml5FilenameChangeExtSafetyPatch(globalScope: BrowserGlobalScope): boolean {
    const directFunction = globalScope.filename_change_ext;
    const nameMap = resolveHtml5BuiltinNameMap(globalScope, FILENAME_CHANGE_EXT_BUILTIN_NAMES);
    const propertyName = typeof directFunction === "function" ? "filename_change_ext" : nameMap?.filename_change_ext;
    if (propertyName === undefined) {
        return false;
    }

    const nativeFunction = globalScope[propertyName];
    if (typeof nativeFunction !== "function") {
        return false;
    }

    if (Reflect.get(nativeFunction, FILENAME_CHANGE_EXT_PATCH_MARKER) === true) {
        return false;
    }

    const patchedFunction = function (this: unknown, filename: unknown, newExtension: unknown): unknown {
        const nativeResult = Reflect.apply(nativeFunction, this, [filename, newExtension]);
        if (typeof nativeResult !== "string" || typeof filename !== "string" || typeof newExtension !== "string") {
            return nativeResult;
        }

        if (newExtension.length === 0 || hasFilenameExtension(filename) || nativeResult !== filename) {
            return nativeResult;
        }

        return `${filename}${newExtension}`;
    };

    Reflect.set(patchedFunction, FILENAME_CHANGE_EXT_PATCH_MARKER, true);
    globalScope[propertyName] = patchedFunction;
    return true;
}
