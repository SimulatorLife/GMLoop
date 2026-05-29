import { featherLintRuleMap, gmlLintRuleMap } from "./catalog.js";

export type LintRuleCatalogEntry = Readonly<{
    description: string;
    fixable: "code" | "whitespace" | null;
    ruleId: string;
    schema: ReadonlyArray<unknown>;
}>;

function createLintRuleCatalogEntries(
    rulesByNamespace: Readonly<
        Record<
            string,
            { meta?: { docs?: { description?: string }; fixable?: "code" | "whitespace"; schema?: unknown } }
        >
    >,
    namespace: "feather" | "gml"
): Array<LintRuleCatalogEntry> {
    return Object.entries(rulesByNamespace)
        .map(([ruleName, ruleModule]) =>
            Object.freeze({
                description: ruleModule.meta?.docs?.description ?? "No rule description is available.",
                fixable: ruleModule.meta?.fixable ?? null,
                ruleId: `${namespace}/${ruleName}`,
                schema: Array.isArray(ruleModule.meta?.schema) ? ruleModule.meta.schema : []
            })
        )
        .sort((leftEntry, rightEntry) => leftEntry.ruleId.localeCompare(rightEntry.ruleId));
}

/**
 * List built-in lint rule metadata for UI and documentation surfaces.
 */
export function listLintRuleCatalogEntries(): ReadonlyArray<LintRuleCatalogEntry> {
    return Object.freeze([
        ...createLintRuleCatalogEntries(gmlLintRuleMap, "gml"),
        ...createLintRuleCatalogEntries(featherLintRuleMap, "feather")
    ]);
}
