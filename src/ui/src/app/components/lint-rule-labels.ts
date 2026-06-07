import type { GraphVisualizationProjectConfigurationLintRuleEntry } from "../../graph/types.js";

/**
 * Returns the canonical badge label for lint rule fixability.
 */
export function getLintFixableBadgeLabel(
    fixable: GraphVisualizationProjectConfigurationLintRuleEntry["fixable"]
): string | null {
    if (fixable === null) {
        return null;
    }

    return "fixable";
}
