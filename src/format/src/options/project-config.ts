import type { GmloopProjectConfig } from "@gmloop/core";

const FORMATTER_OWNED_CONFIG_KEYS = new Set([
    "allowInlineControlFlowBlocks",
    "bracketSpacing",
    "endOfLine",
    "logicalOperatorsStyle",
    "objectWrap",
    "printWidth",
    "semi",
    "singleQuote",
    "tabWidth",
    "trailingComma",
    "useTabs",
    "variableDeclarationsBeforeLoopPadding"
]);

/**
 * Extract formatter-owned options from a shared `gmloop.json` object.
 *
 * The formatter must ignore project-aware sections owned by lint/refactor and
 * any unrelated future workspace config. Using an allowlist keeps the format
 * workspace scoped to layout options only.
 *
 * @param config Shared top-level project config.
 * @returns Formatter option bag containing only formatter-owned keys.
 */
export function extractProjectFormatOptions(config: GmloopProjectConfig): Record<string, unknown> {
    const options = Object.fromEntries(Object.entries(config).filter(([key]) => FORMATTER_OWNED_CONFIG_KEYS.has(key)));

    return Object.freeze(options);
}
