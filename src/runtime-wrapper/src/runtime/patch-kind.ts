import type { PatchKind } from "./types.js";

/**
 * Registry collection keys keyed by runtime patch kind.
 */
export type RegistryCollectionKey = "scripts" | "events" | "closures";

type PatchKindMetadata = Readonly<{
    registryCollectionKey: RegistryCollectionKey;
    displayName: string;
}>;

const PATCH_KIND_METADATA: Readonly<Record<PatchKind, PatchKindMetadata>> = Object.freeze({
    script: Object.freeze({ registryCollectionKey: "scripts", displayName: "Script" }),
    event: Object.freeze({ registryCollectionKey: "events", displayName: "Event" }),
    closure: Object.freeze({ registryCollectionKey: "closures", displayName: "Closure" })
});

const PATCH_KINDS: ReadonlyArray<PatchKind> = Object.freeze(Object.keys(PATCH_KIND_METADATA) as Array<PatchKind>);

/**
 * Returns metadata for the provided patch kind.
 *
 * @param kind Runtime patch kind.
 * @returns Metadata describing the patch kind.
 */
export function getPatchKindMetadata(kind: PatchKind): PatchKindMetadata {
    return PATCH_KIND_METADATA[kind];
}

/**
 * Returns every supported patch kind in canonical processing order.
 *
 * @returns Frozen ordered list of patch kinds.
 */
export function getSupportedPatchKinds(): ReadonlyArray<PatchKind> {
    return PATCH_KINDS;
}

/**
 * Checks whether a string is a supported patch kind.
 *
 * @param value Candidate value to validate.
 * @returns `true` when the value is a known patch kind.
 */
export function isSupportedPatchKind(value: string): value is PatchKind {
    return Object.hasOwn(PATCH_KIND_METADATA, value);
}
