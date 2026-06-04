/**
 * SCIP ID generation helpers for the refactor bridge.
 *
 * These are pure transformation functions that convert semantic index
 * resource records and identifier entries into SCIP-compliant symbol IDs
 * following the `gml/<kind>/<name>` scheme used by @gmloop/semantic.
 */

type ResourceRecord = {
    name?: string;
    resourceType?: string;
    path?: string;
};

type IdentifierEntry = Record<string, unknown> & {
    name?: string;
    identifierId?: string;
};

/**
 * Maps GameMaker `resourceType` values to SCIP kind segments used in
 * `gml/<kind>/<name>` IDs.
 *
 * Falls through to `"resource"` when the resource type is unrecognized,
 * matching the historical fallback in `GmlSemanticBridge`.
 */
export function mapResourceTypeToScipKind(resourceType: string | undefined): string {
    switch (resourceType) {
        case "GMObject": {
            return "objects";
        }
        case "GMSprite": {
            return "sprites";
        }
        case "GMRoom": {
            return "rooms";
        }
        case "GMScript": {
            return "scripts";
        }
        case "GMAudio":
        case "GMSound": {
            return "sounds";
        }
        case "GMPath": {
            return "paths";
        }
        case "GMAnimCurve":
        case "GMAnimationCurve": {
            return "curves";
        }
        case "GMShader": {
            return "shaders";
        }
        case "GMFont": {
            return "fonts";
        }
        case "GMTimeline": {
            return "timelines";
        }
        case "GMTileSet": {
            return "tilesets";
        }
        case "GMSequence": {
            return "sequences";
        }
        case "GMParticleSystem": {
            return "particlesystems";
        }
        case "GMNote":
        case "GMNotes": {
            return "notes";
        }
        case "GMExtension": {
            return "extensions";
        }
        default: {
            return "resource";
        }
    }
}

/**
 * Generates a SCIP-style symbol ID for a GameMaker resource.
 *
 * Produces identifiers following the pattern `gml/<kind>/<name>`, e.g.
 * `gml/objects/obj_player`.  Returns an empty string when `name` or
 * `resourceType` are absent.
 *
 * @example
 * generateResourceScipId({ name: "obj_player", resourceType: "GMObject" })
 * // → "gml/objects/obj_player"
 */
export function generateResourceScipId(resource: ResourceRecord): string {
    if (!resource.name || !resource.resourceType) {
        return "";
    }

    const kind = mapResourceTypeToScipKind(resource.resourceType);
    return `gml/${kind}/${resource.name}`;
}

/**
 * Synthesizes a minimal semantic index entry for a resource that was
 * resolved by name but may not appear in the raw semantic index.
 *
 * The returned record satisfies the `SemanticIdentifierEntry` shape that
 * the bridge uses for rename collection.  Declarations are populated with
 * a zero-length placeholder; callers that need real span data must
 * populate the `references` array separately via asset scanning.
 */
export function createSyntheticResourceEntry(resource: ResourceRecord, symbolId: string): IdentifierEntry {
    return {
        identifierId: symbolId,
        name: resource.name,
        kind: resource.resourceType,
        declarations: [
            {
                filePath: resource.path,
                start: { index: 0, line: 0, column: 0 },
                end: { index: 0, line: 0, column: 0 },
                kind: "definition"
            }
        ],
        references: [],
        resourcePath: resource.path
    };
}

/**
 * Infers the SCIP kind segment from an identifier entry's `identifierId`
 * prefix and produces the corresponding `gml/<kind>/<name>` symbol ID.
 *
 * Falls back to `gml/var/<name>` when no recognized prefix is present.
 *
 * @param entry   - Semantic identifier entry (may contain `identifierId`).
 * @param nestedName - Optional explicit name; defaults to `entry.name`.
 */
export function generateIdentifierEntryScipId(entry: IdentifierEntry, nestedName?: string): string {
    const name = nestedName ?? entry.name;
    if (!name) {
        return "";
    }

    const id = entry.identifierId ?? "";
    let scipKind: string;

    if (id.startsWith("script:")) {
        scipKind = "script";
    } else if (id.startsWith("macro:")) {
        scipKind = "macro";
    } else if (id.startsWith("enum:")) {
        scipKind = "enum";
    } else if (id.startsWith("global:") || id.startsWith("instance:")) {
        scipKind = "var";
    } else {
        scipKind = "var";
    }

    return `gml/${scipKind}/${name}`;
}

/**
 * Returns true when any symbol ID in the set ends with `/<name>`.
 *
 * Provides a simple prefix-free membership check using the trailing
 * path component rather than full identifier matching.
 */
export function matchesSymbolIdSet(symbolIds: ReadonlySet<string>, name: string): boolean {
    const suffix = `/${name}`;
    for (const id of symbolIds) {
        if (id.endsWith(suffix)) {
            return true;
        }
    }
    return false;
}
