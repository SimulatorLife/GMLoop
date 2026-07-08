import { Core } from "@gmloop/core";

import type { KeywordProvider } from "../types.js";

type ReservedIdentifierContext = "ordinary-binding" | "argument-binding" | "enum-member";

const SUPPLEMENTAL_ORDINARY_RESERVED_IDENTIFIER_NAMES: ReadonlyArray<string> = Object.freeze([
    // Common implicit bindings that must never be introduced by codemods.
    "self",
    "other",
    "global",
    // Reserved identifiers observed in real-world GameMaker projects that are not
    // consistently present in bundled metadata across IDE/runtime versions.
    "colour",
    "color",
    "scaler",
    "poisson_disk_sample"
]);

function addNormalizedNames(destination: Set<string>, names: Iterable<string>): void {
    for (const name of names) {
        destination.add(name);
    }
}

/**
 * Build the reserved identifier set used by refactor conflict detection and
 * naming-convention codemods.
 *
 * The set always includes static Core binding reservations and can optionally
 * merge semantic-provider language reservations. For ordinary/argument binding
 * checks we include a small supplemental set of runtime-reserved identifiers to
 * guard against metadata drift across GameMaker versions.
 */
export async function loadRefactorReservedIdentifierNames(
    context: ReservedIdentifierContext,
    keywordProvider: Partial<KeywordProvider> | null
): Promise<ReadonlySet<string>> {
    const names = new Set<string>();
    addNormalizedNames(names, Core.loadReservedGmlBindingIdentifierNames(context));
    if (context !== "enum-member") {
        addNormalizedNames(names, SUPPLEMENTAL_ORDINARY_RESERVED_IDENTIFIER_NAMES);
    }

    if (!Core.hasMethods(keywordProvider, "getReservedKeywords")) {
        return names;
    }

    const semanticReserved = await keywordProvider.getReservedKeywords();
    if (Array.isArray(semanticReserved)) {
        addNormalizedNames(names, semanticReserved);
    }

    return names;
}
