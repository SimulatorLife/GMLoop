import type { GmloopProjectConfig } from "@gmloop/core";

import { PROJECT_FORMAT_OPTION_CATALOG } from "./project-config-catalog.js";

const FORMATTER_OWNED_CONFIG_KEYS: ReadonlySet<string> = new Set(
    PROJECT_FORMAT_OPTION_CATALOG.map((entry) => entry.name)
);

/**
 * Extract formatter-owned options from a shared `gmloop.json` object.
 *
 * The formatter must ignore project-aware sections owned by lint/refactor and
 * any unrelated future workspace config. Using an allowlist keeps the format
 * workspace scoped to layout options only.
 *
 * The allowlist is derived from {@link PROJECT_FORMAT_OPTION_CATALOG} so the
 * set of keys accepted here and the option metadata exposed for UI and
 * documentation surfaces can never drift apart.
 *
 * @param config Shared top-level project config.
 * @returns Formatter option bag containing only formatter-owned keys.
 */
export function extractProjectFormatOptions(config: GmloopProjectConfig): Record<string, unknown> {
    const options = Object.fromEntries(Object.entries(config).filter(([key]) => FORMATTER_OWNED_CONFIG_KEYS.has(key)));

    return Object.freeze(options);
}
