export type FeatherDefaultSeverity = "warn" | "error";

export type FeatherFixability = "none" | "safe-only" | "always";

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type FeatherParityId = `GM${Digit}${Digit}${Digit}${Digit}`;
type FeatherRuleId = `feather/${Lowercase<FeatherParityId>}`;

export type FeatherManifestEntry = Readonly<{
    id: FeatherParityId;
    ruleId: FeatherRuleId;
    defaultSeverity: FeatherDefaultSeverity;
    fixability: FeatherFixability;
    requiresProjectContext: boolean;
    fixScope: "local-only";
    conflictingGmlRuleIds: ReadonlyArray<`gml/${string}`>;
    messageIds: ReadonlyArray<"diagnostic" | "unsafeFix" | "missingProjectContext">;
}>;

export type FeatherManifest = Readonly<{
    schemaVersion: 1;
    entries: ReadonlyArray<FeatherManifestEntry>;
}>;

const FEATHER_PARITY_IDS: ReadonlyArray<FeatherParityId> = Object.freeze([
    "GM1000",
    "GM1002",
    "GM1003",
    "GM1004",
    "GM1005",
    "GM1007",
    "GM1008",
    "GM1009",
    "GM1010",
    "GM1012",
    "GM1013",
    "GM1014",
    "GM1015",
    "GM1016",
    "GM1017",
    "GM1021",
    "GM1023",
    "GM1024",
    "GM1026",
    "GM1028",
    "GM1029",
    "GM1030",
    "GM1032",
    "GM1033",
    "GM1034",
    "GM1036",
    "GM1038",
    "GM1041",
    "GM1051",
    "GM1052",
    "GM1054",
    "GM1055",
    "GM1056",
    "GM1058",
    "GM1059",
    "GM1062",
    "GM1063",
    "GM1064",
    "GM1100",
    "GM2000",
    "GM2003",
    "GM2004",
    "GM2005",
    "GM2007",
    "GM2008",
    "GM2009",
    "GM2011",
    "GM2012",
    "GM2015",
    "GM2020",
    "GM2023",
    "GM2025",
    "GM2026",
    "GM2028",
    "GM2029",
    "GM2030",
    "GM2031",
    "GM2032",
    "GM2033",
    "GM2035",
    "GM2040",
    "GM2042",
    "GM2043",
    "GM2044",
    "GM2046",
    "GM2048",
    "GM2049",
    "GM2050",
    "GM2051",
    "GM2052",
    "GM2053",
    "GM2054",
    "GM2056",
    "GM2061",
    "GM2062",
    "GM2063",
    "GM2064"
]);

const FEATHER_DIAGNOSTIC_ID_PATTERN = /^GM\d{4}$/u;
const FEATHER_RULE_ID_PATTERN = /^feather\/gm\d{4}$/u;

function toFeatherRuleId(id: FeatherParityId): FeatherRuleId {
    if (!FEATHER_DIAGNOSTIC_ID_PATTERN.test(id)) {
        throw new Error(`Invalid feather parity id: ${id}`);
    }

    return `feather/${id.toLowerCase()}` as FeatherRuleId;
}

function toFeatherParityId(ruleId: FeatherRuleId): FeatherParityId {
    if (!FEATHER_RULE_ID_PATTERN.test(ruleId)) {
        throw new Error(`Invalid feather rule id: ${ruleId}`);
    }

    return ruleId.slice("feather/".length).toUpperCase() as FeatherParityId;
}

const FEATHER_MESSAGE_IDS = Object.freeze(["diagnostic", "unsafeFix", "missingProjectContext"] as const);
const FEATHER_GML_AUTOFIX_CONFLICTS: Readonly<Partial<Record<FeatherParityId, ReadonlyArray<`gml/${string}`>>>> =
    Object.freeze({
        GM1062: Object.freeze(["gml/normalize-doc-comments"] as const)
    });
const ALWAYS_FIXABLE_FEATHER_IDS: ReadonlySet<FeatherParityId> = new Set(["GM1033", "GM1051", "GM2007"]);
const REPORT_ONLY_FEATHER_IDS: ReadonlySet<FeatherParityId> = new Set([
    "GM1004",
    "GM1005",
    "GM1007",
    "GM1014",
    "GM1015",
    "GM1021",
    "GM1026",
    "GM1034",
    "GM1038",
    "GM1054",
    "GM1059",
    "GM1063",
    "GM1064",
    "GM1100",
    "GM2012",
    "GM2015",
    "GM2023",
    "GM2025",
    "GM2029",
    "GM2033",
    "GM2040",
    "GM2064"
]);
const PROJECT_CONTEXT_FEATHER_IDS: ReadonlySet<FeatherParityId> = new Set([
    "GM1021",
    "GM1038",
    "GM1054",
    "GM1064",
    "GM2025",
    "GM2040",
    "GM2064"
]);

function resolveFixability(id: FeatherParityId): FeatherFixability {
    if (REPORT_ONLY_FEATHER_IDS.has(id)) {
        return "none";
    }
    if (ALWAYS_FIXABLE_FEATHER_IDS.has(id)) {
        return "always";
    }
    return "safe-only";
}

const entries: ReadonlyArray<FeatherManifestEntry> = Object.freeze(
    FEATHER_PARITY_IDS.map((id) => {
        const conflictingGmlRuleIds = FEATHER_GML_AUTOFIX_CONFLICTS[id] ?? Object.freeze([]);
        return Object.freeze({
            id,
            ruleId: (() => {
                const ruleId = toFeatherRuleId(id);
                if (toFeatherParityId(ruleId) !== id) {
                    throw new Error(`Inconsistent feather mapping for ${id}`);
                }
                return ruleId;
            })(),
            defaultSeverity: "warn",
            fixability: resolveFixability(id),
            requiresProjectContext: PROJECT_CONTEXT_FEATHER_IDS.has(id),
            fixScope: "local-only",
            conflictingGmlRuleIds,
            messageIds: FEATHER_MESSAGE_IDS
        });
    })
);

/**
 * Pins the feather manifest schema version for semver-sensitive consumers.
 */
export const FEATHER_MANIFEST_SCHEMA_VERSION = 1 as const;

export const featherManifest: FeatherManifest = Object.freeze({
    schemaVersion: FEATHER_MANIFEST_SCHEMA_VERSION,
    entries
});
