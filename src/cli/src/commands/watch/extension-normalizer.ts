import path from "node:path";

import { Core } from "@gmloop/core";

const { compactArray, createListSplitPattern, normalizeExtensionSuffix, normalizeStringList, uniqueArray } = Core;

type ExtensionInput = string | Iterable<string> | Array<string> | null | undefined;

const EXTENSION_LIST_SPLIT_PATTERN = createListSplitPattern(compactArray([",", path.delimiter]), {
    includeWhitespace: true
});

function coerceExtensionValue(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const cleaned = value
        .toLowerCase()
        .replace(/.*[\\/]/, "")
        .replace(/^[*?]+/, "");

    if (!cleaned) {
        return null;
    }

    const extensionCandidate =
        cleaned.startsWith(".") || !cleaned.includes(".") ? cleaned : path.extname(cleaned) || cleaned;

    return normalizeExtensionSuffix(extensionCandidate);
}

function splitExtensionInput(value: unknown): Array<string> {
    return normalizeStringList(value, {
        splitPattern: EXTENSION_LIST_SPLIT_PATTERN,
        allowInvalidType: true
    }) as Array<string>;
}

function collectRawExtensionEntries(rawExtensions: ExtensionInput): Array<unknown> {
    if (typeof rawExtensions === "string") {
        return [rawExtensions];
    }

    if (rawExtensions === null || rawExtensions === undefined) {
        return [rawExtensions];
    }

    if (typeof rawExtensions[Symbol.iterator] === "function") {
        return Array.from(rawExtensions);
    }

    return [rawExtensions];
}

export function normalizeExtensions(
    rawExtensions: ExtensionInput,
    fallbackExtensions: ReadonlyArray<string> = []
): Array<string> {
    const fragments = collectRawExtensionEntries(rawExtensions).flatMap((value) => splitExtensionInput(value));

    const coerced = fragments.map((fragment) => coerceExtensionValue(fragment));
    const normalized = uniqueArray(compactArray(coerced), {
        freeze: false
    }) as Array<string>;

    return normalized.length > 0 ? normalized : fallbackExtensions.map(String);
}

export { EXTENSION_LIST_SPLIT_PATTERN };
