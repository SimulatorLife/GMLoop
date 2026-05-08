import type { GmlFormatComponentBundle, GmlFormatDefaultOptions } from "./format-types.js";

/**
 * Abstract provider boundary for the formatter orchestration layer.
 *
 * High-level plugin wiring consumes this contract instead of importing parser,
 * printer, comment, or layout-normalization implementations directly. Concrete
 * adapters are assembled behind this boundary by the format component module.
 */
export type GmlFormatProvider = Readonly<{
    components: GmlFormatComponentBundle;
    prettierDefaults: GmlFormatDefaultOptions;
    normalizeFormattedOutput: (formatted: string) => string;
}>;

/**
 * Create an immutable formatter provider from already-assembled abstractions.
 *
 * This keeps provider construction deterministic while allowing tests or future
 * composition roots to inject alternate component bundles without coupling the
 * high-level Prettier plugin entry point to concrete parser/printer adapters.
 */
export function createGmlFormatProvider(provider: GmlFormatProvider): GmlFormatProvider {
    return Object.freeze({
        components: provider.components,
        prettierDefaults: Object.freeze({
            ...provider.prettierDefaults
        }),
        normalizeFormattedOutput: provider.normalizeFormattedOutput
    });
}
