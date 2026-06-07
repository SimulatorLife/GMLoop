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
