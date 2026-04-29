/**
 * Runtime shape for the lint plugin objects consumed by lint config presets.
 *
 * This type is intentionally declared in a dedicated contract module so the
 * config layer and plugin entry point can both depend on the same boundary
 * without creating import cycles.
 */
export type LintPluginShape = Readonly<{
    rules: Record<string, unknown>;
    languages?: Record<string, unknown>;
}>;
