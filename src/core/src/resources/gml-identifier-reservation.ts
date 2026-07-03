import {
    getIdentifierMetadata,
    loadReservedIdentifierNames,
    normalizeIdentifierMetadataEntries
} from "./gml-identifier-loading.js";

/**
 * GML binding position used when checking whether a language identifier is
 * unavailable as a newly declared name.
 */
export type GmlBindingIdentifierContext = "ordinary-binding" | "argument-binding" | "enum-member";

const ARGUMENT_BINDING_RESERVED_IDENTIFIER_NAMES: ReadonlySet<string> = new Set(["id", "self", "other", "global"]);
const ORDINARY_BINDING_MANUAL_IDENTIFIER_NAMES: ReadonlyArray<string> = Object.freeze(["id"]);
const ENUM_MEMBER_RESERVED_IDENTIFIER_TYPES: ReadonlySet<string> = new Set(["keyword", "literal"]);

function assertGmlBindingIdentifierContext(context: string): asserts context is GmlBindingIdentifierContext {
    if (context === "ordinary-binding" || context === "argument-binding" || context === "enum-member") {
        return;
    }

    throw new TypeError(
        `Unknown GML binding identifier context '${context}'. Expected ordinary-binding, argument-binding, or enum-member.`
    );
}

function normalizeReservationName(name: string): string {
    if (typeof name !== "string") {
        throw new TypeError("GML binding identifier names must be strings.");
    }

    return name.toLowerCase();
}

function getNormalizedIdentifierEntries() {
    return normalizeIdentifierMetadataEntries(getIdentifierMetadata());
}

function addManualIdentifierNames(names: Set<string>, manualNames: ReadonlyArray<string>): void {
    for (const name of manualNames) {
        names.add(name.toLowerCase());
    }
}

function loadOrdinaryBindingReservedIdentifierNames(): ReadonlySet<string> {
    const names = new Set(loadReservedIdentifierNames({ disallowedTypes: [] }));
    addManualIdentifierNames(names, ORDINARY_BINDING_MANUAL_IDENTIFIER_NAMES);
    return names;
}

function loadArgumentBindingReservedIdentifierNames(): ReadonlySet<string> {
    const names = new Set<string>();

    for (const { name } of getNormalizedIdentifierEntries()) {
        const normalizedName = name.toLowerCase();
        if (ARGUMENT_BINDING_RESERVED_IDENTIFIER_NAMES.has(normalizedName)) {
            names.add(normalizedName);
        }
    }

    addManualIdentifierNames(names, ORDINARY_BINDING_MANUAL_IDENTIFIER_NAMES);
    return names;
}

function loadEnumMemberReservedIdentifierNames(): ReadonlySet<string> {
    const names = new Set<string>();

    for (const { name, type } of getNormalizedIdentifierEntries()) {
        if (ENUM_MEMBER_RESERVED_IDENTIFIER_TYPES.has(type.toLowerCase())) {
            names.add(name.toLowerCase());
        }
    }

    return names;
}

/**
 * Load language-level GML identifiers that cannot be introduced in a binding
 * position represented by `context`.
 *
 * This is intentionally limited to static language facts derived from the
 * bundled GameMaker identifier metadata. Callers remain responsible for
 * semantic checks such as scope collisions, symbol resolution, and refactor
 * diagnostics.
 *
 * @param context Binding position to classify.
 * @returns Lower-case reserved identifier names for the context.
 */
export function loadReservedGmlBindingIdentifierNames(context: GmlBindingIdentifierContext): ReadonlySet<string> {
    assertGmlBindingIdentifierContext(context);

    switch (context) {
        case "ordinary-binding": {
            return loadOrdinaryBindingReservedIdentifierNames();
        }
        case "argument-binding": {
            return loadArgumentBindingReservedIdentifierNames();
        }
        case "enum-member": {
            return loadEnumMemberReservedIdentifierNames();
        }
    }
}

/**
 * Check whether `name` is reserved in a static GML binding context.
 *
 * Names are compared case-insensitively because GameMaker identifiers are
 * case-insensitive for these language-level conflicts.
 *
 * @param name Candidate identifier name.
 * @param context Binding position to classify.
 * @returns True when `name` is reserved in the supplied context.
 */
export function isReservedGmlBindingIdentifierName(name: string, context: GmlBindingIdentifierContext): boolean {
    return loadReservedGmlBindingIdentifierNames(context).has(normalizeReservationName(name));
}
