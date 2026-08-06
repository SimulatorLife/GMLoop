import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Lint } from "@gmloop/lint";
import { Refactor, type RefactorCodemodId } from "@gmloop/refactor";

import { createRefactorBridges } from "../../../modules/refactor/bridge-factory.js";

function createMutableGraphPlaygroundLintConfig(
    enabledRuleIds: ReadonlyArray<string>,
    fixtureConfig: Record<string, unknown> | null = null
): Array<Record<string, unknown>> {
    const enabledRules = new Set(enabledRuleIds);
    const enforceRuleFilter = enabledRules.size > 0;
    const fixtureRuleEntries = fixtureConfig
        ? Lint.configs.createLintRuleEntriesFromProjectConfig(fixtureConfig)
        : null;

    return Lint.configs.recommended.map((config) => {
        const nextConfig = {
            ...config,
            files: Array.isArray(config.files) ? [...config.files] : config.files,
            plugins: config.plugins ? { ...config.plugins } : undefined,
            rules: config.rules ? { ...config.rules } : undefined
        };

        const rules = nextConfig.rules as Record<string, unknown> | undefined;
        if (rules && typeof rules === "object") {
            if (fixtureRuleEntries) {
                for (const [ruleId, ruleEntry] of Object.entries(fixtureRuleEntries)) {
                    if (rules[ruleId] !== undefined) {
                        rules[ruleId] = ruleEntry;
                    }
                }
            }

            if (enforceRuleFilter) {
                for (const ruleId of Object.keys(rules)) {
                    if (!enabledRules.has(ruleId)) {
                        rules[ruleId] = "off";
                    }
                }
            }
        }

        return nextConfig;
    });
}

function createGraphPlaygroundFormatOptions(
    selectedOptionNames: ReadonlyArray<string>,
    activeProjectConfig: Record<string, unknown> | null
): Record<string, unknown> {
    const configuredFormatOptions = Format.extractProjectFormatOptions(activeProjectConfig ?? {});
    const selectedOptionNameSet = new Set(selectedOptionNames);
    if (selectedOptionNameSet.size === 0) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(configuredFormatOptions).filter(([optionName]) => selectedOptionNameSet.has(optionName))
    );
}

function createRefactorEngineForPlayground(activeProjectRoot: string) {
    const bridges = createRefactorBridges({}, activeProjectRoot);
    return Refactor.createRefactorEngine({
        formatter: bridges.formatter,
        parser: bridges.parser,
        semantic: bridges.semantic
    });
}

/**
 * Parse and validate a playground fixture `gmloop.json` config payload.
 *
 * Playground fixtures live alongside the test sources and are surfaced to
 * users through the graph visualization server. Because they are
 * hand-edited on disk, the inputs are intentionally untrusted — malformed
 * JSON, `null`, arrays, or primitive top-level values would silently leak
 * through the previous `JSON.parse(source) as Record<string, unknown>`
 * cast and crash downstream consumers the first time they read a nested
 * property (e.g. `config.refactor` on `null`). This guard turns those
 * failure modes into self-documenting `TypeError`s that name the offending
 * file path and attach the original parse error via `cause` so the caller
 * can recover (skip the fixture) without losing the rest of the
 * playground.
 *
 * @param source Raw `gmloop.json` file contents.
 * @param filePath Absolute path used to localize error messages.
 * @returns A frozen shallow copy of the parsed JSON object.
 * @throws {TypeError} When `source` is not valid JSON or when the parsed
 *                     top-level value is not a plain JSON object.
 */
function parsePlaygroundFixtureConfig(source: string, filePath: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        const reason = Core.getErrorMessage(error);
        throw new TypeError(`Playground fixture config at ${filePath} is not valid JSON (${reason}).`, {
            cause: error
        });
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        const actualKind = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed;
        throw new TypeError(`Playground fixture config at ${filePath} must be a JSON object, received ${actualKind}.`);
    }

    return Object.freeze({ ...(parsed as Record<string, unknown>) });
}

async function applySelectedPlaygroundCodemods(
    sourceText: string,
    selectedCodemodIds: ReadonlyArray<string>,
    activeProjectRoot: string,
    activeProjectConfig: Record<string, unknown> | null
): Promise<string> {
    if (selectedCodemodIds.length === 0) {
        return sourceText;
    }

    const registeredCodemodIds = new Set(Refactor.listRegisteredCodemods().map((codemod) => codemod.id));
    const onlyCodemods = selectedCodemodIds.filter((codemodId): codemodId is RefactorCodemodId =>
        registeredCodemodIds.has(codemodId as RefactorCodemodId)
    );
    if (onlyCodemods.length === 0) {
        return sourceText;
    }

    const normalizedRefactorConfig = Refactor.normalizeRefactorProjectConfig(activeProjectConfig?.refactor);
    const rawCodemodConfig: Record<string, unknown> = { ...normalizedRefactorConfig.codemods };
    for (const codemodId of onlyCodemods) {
        if (rawCodemodConfig[codemodId] !== undefined) {
            continue;
        }
        rawCodemodConfig[codemodId] = codemodId === "namingConvention" ? { rules: {} } : {};
    }
    const config = Refactor.normalizeRefactorProjectConfig({ codemods: rawCodemodConfig });

    const engine = createRefactorEngineForPlayground(activeProjectRoot);
    const virtualFilePath = "graph-visualization-playground.gml";
    const nextOutput = sourceText;
    const result = await engine.executeConfiguredCodemods({
        config,
        dryRun: true,
        gmlFilePaths: [virtualFilePath],
        onlyCodemods,
        projectRoot: activeProjectRoot,
        readFile: () => nextOutput,
        targetPaths: [virtualFilePath]
    });

    const updatedOutput = result.appliedFiles.get(virtualFilePath);
    return updatedOutput ?? nextOutput;
}

export {
    applySelectedPlaygroundCodemods,
    createGraphPlaygroundFormatOptions,
    createMutableGraphPlaygroundLintConfig,
    createRefactorEngineForPlayground,
    parsePlaygroundFixtureConfig
};
