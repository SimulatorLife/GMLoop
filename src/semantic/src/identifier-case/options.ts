// Identifier-case helpers (e.g. pascal case, camel case).
//
// Keeps option names, descriptions, and normalization utilities grouped in one
// place so the CLI, documentation, and project-index pipeline can share a
// single source of truth.

import { Core } from "@gmloop/core";

import { PROJECT_INDEX_GML_CONCURRENCY_BASELINE } from "../project-index/constants.js";
import { getIdentifierCaseStyleMetadata } from "./identifier-case-utils.js";
import { DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES } from "./option-store-defaults.js";

export { DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES } from "./option-store-defaults.js";

const IDENTIFIER_CASE_DESCRIPTION = "Sets the preferred casing style to apply when renaming identifiers.";

export const IdentifierCaseStyle = Object.freeze({
    OFF: "off",
    CAMEL: "camel",
    PASCAL: "pascal",
    SNAKE_LOWER: "snake-lower",
    SNAKE_UPPER: "snake-upper"
} as const);

export type IdentifierCaseStyleValue = (typeof IdentifierCaseStyle)[keyof typeof IdentifierCaseStyle];

const IDENTIFIER_CASE_STYLE_SET: ReadonlySet<string> = new Set(Object.values(IdentifierCaseStyle));

export const IDENTIFIER_CASE_STYLES = Object.freeze(Object.values(IdentifierCaseStyle));

const IDENTIFIER_CASE_LIST_SPLIT_PATTERN = Core.createListSplitPattern(["\n", ","]);

export const IDENTIFIER_CASE_INHERIT_VALUE = "inherit";

type IdentifierCaseScopeSetting = IdentifierCaseStyleValue | typeof IDENTIFIER_CASE_INHERIT_VALUE;
type IdentifierCaseScope = (typeof IDENTIFIER_CASE_SCOPE_NAMES)[number];
type IdentifierCaseRawOptions = Record<string, unknown>;

export function isIdentifierCaseStyle(style: unknown): style is IdentifierCaseStyleValue {
    return typeof style === "string" && IDENTIFIER_CASE_STYLE_SET.has(style);
}

function createUnknownIdentifierCaseStyleError(style: unknown, optionName: string): RangeError {
    const validStyles = Array.from(IDENTIFIER_CASE_STYLE_SET).join(", ");
    const received = Core.describeValueForError(style);
    return new RangeError(
        `Invalid identifier case style '${received}' for ${optionName}. Valid styles: ${validStyles}.`
    );
}

export function parseIdentifierCaseStyle(value: unknown): IdentifierCaseStyleValue | null {
    return isIdentifierCaseStyle(value) ? value : null;
}

export function requireIdentifierCaseStyle(value: unknown, context?: string): IdentifierCaseStyleValue {
    if (!isIdentifierCaseStyle(value)) {
        throw createUnknownIdentifierCaseStyleError(value, context ?? "identifier case style");
    }

    return value;
}

export function assertIdentifierCaseStyle(style: unknown, optionName: string): IdentifierCaseStyleValue {
    return requireIdentifierCaseStyle(style, optionName);
}

function normalizeIdentifierCaseStyleOption(
    style: unknown,
    { optionName, defaultValue }: { optionName: string; defaultValue: IdentifierCaseStyleValue }
): IdentifierCaseStyleValue {
    return style === undefined ? defaultValue : requireIdentifierCaseStyle(style, optionName);
}

export const IDENTIFIER_CASE_SCOPE_NAMES = Object.freeze([
    "functions",
    "structs",
    "locals",
    "instance",
    "globals",
    "assets",
    "macros"
] as const);

export const IDENTIFIER_CASE_BASE_OPTION_NAME = "gmlIdentifierCase";
export const IDENTIFIER_CASE_IGNORE_OPTION_NAME = "gmlIdentifierCaseIgnore";
export const IDENTIFIER_CASE_PRESERVE_OPTION_NAME = "gmlIdentifierCasePreserve";
export const IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME = "gmlIdentifierCaseAcknowledgeAssetRenames";
export const IDENTIFIER_CASE_DISCOVER_PROJECT_OPTION_NAME = "gmlIdentifierCaseDiscoverProject";
export const IDENTIFIER_CASE_PROJECT_ROOT_OPTION_NAME = "gmlIdentifierCaseProjectRoot";
export const IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_OPTION_NAME = "gmlIdentifierCaseOptionStoreMaxEntries";
export const IDENTIFIER_CASE_PROJECT_INDEX_CONCURRENCY_OPTION_NAME = "gmlIdentifierCaseProjectIndexConcurrency";

const IDENTIFIER_CASE_SCOPE_OPTION_PREFIX = "gmlIdentifierCase";
const BASE_IDENTIFIER_CASE_SINCE = "0.0.0";
const ASSET_SCOPE_NAME = "assets";
const ASSET_SCOPE_OPTION_NAME = getScopeOptionName(ASSET_SCOPE_NAME);

export function normalizeIdentifierCaseAssetStyle(style: unknown): IdentifierCaseStyleValue {
    if (style == null) {
        return IdentifierCaseStyle.OFF;
    }

    return requireIdentifierCaseStyle(style, ASSET_SCOPE_OPTION_NAME);
}

type IdentifierCaseOptionChoice = { value: string; description: string };
type IdentifierCaseOptionConfig = {
    since: string;
    type: string;
    category: "gml";
    default: unknown;
    description: string;
    range?: { start: number; end: number };
    choices?: IdentifierCaseOptionChoice[];
};

type IdentifierCaseIntegerOptionConfigInput = {
    defaultValue: number;
    minValue: number;
    description: string;
};

function createChoice(value: string, description: string): IdentifierCaseOptionChoice {
    return { value, description };
}

export const IDENTIFIER_CASE_STYLE_CHOICES = IDENTIFIER_CASE_STYLES.map((style) => {
    const { description = IDENTIFIER_CASE_DESCRIPTION } = getIdentifierCaseStyleMetadata(style);
    return createChoice(style, description);
});

function getScopeOptionName(scope: string): string {
    return `${IDENTIFIER_CASE_SCOPE_OPTION_PREFIX}${Core.capitalize(scope)}`;
}

function createScopeChoiceEntries(): IdentifierCaseOptionChoice[] {
    const inheritChoice = createChoice(IDENTIFIER_CASE_INHERIT_VALUE, "Inherit the default gmlIdentifierCase value.");
    return [inheritChoice, ...IDENTIFIER_CASE_STYLE_CHOICES];
}

function createScopeOptionConfig(scope: string): IdentifierCaseOptionConfig {
    return {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "choice",
        category: "gml",
        default: IDENTIFIER_CASE_INHERIT_VALUE,
        description: `Overrides the base identifier case for ${scope} declarations.`,
        choices: createScopeChoiceEntries()
    };
}

function createIdentifierCaseIntegerOptionConfig({
    defaultValue,
    minValue,
    description
}: IdentifierCaseIntegerOptionConfigInput): IdentifierCaseOptionConfig {
    return {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "int",
        category: "gml",
        default: defaultValue,
        range: { start: minValue, end: Infinity },
        description
    };
}

const baseIdentifierCaseOptions: Record<string, IdentifierCaseOptionConfig> = {
    [IDENTIFIER_CASE_BASE_OPTION_NAME]: {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "choice",
        category: "gml",
        default: "off",
        description: "Configures the default identifier case conversion style applied to eligible declarations.",
        choices: IDENTIFIER_CASE_STYLE_CHOICES
    },
    [IDENTIFIER_CASE_IGNORE_OPTION_NAME]: {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "string",
        category: "gml",
        default: "",
        description: "Comma- or newline-separated patterns describing identifiers or files to ignore while renaming."
    },
    [IDENTIFIER_CASE_PRESERVE_OPTION_NAME]: {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "string",
        category: "gml",
        default: "",
        description: "Comma- or newline-separated list of identifier names that must be preserved without renaming."
    },
    [IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME]: {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "boolean",
        category: "gml",
        default: false,
        description: "Acknowledges that enabling asset renames may rename files on disk and updates related metadata."
    },
    [IDENTIFIER_CASE_DISCOVER_PROJECT_OPTION_NAME]: {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "boolean",
        category: "gml",
        default: true,
        description:
            "Automatically search for the nearest GameMaker project manifest (.yyp) when preparing identifier case plans."
    },
    [IDENTIFIER_CASE_PROJECT_ROOT_OPTION_NAME]: {
        since: BASE_IDENTIFIER_CASE_SINCE,
        type: "path",
        category: "gml",
        default: "",
        description:
            "Overrides automatic discovery with an explicit GameMaker project root directory when building identifier indexes."
    }
};

function createIdentifierCaseOptions(): Record<string, IdentifierCaseOptionConfig> {
    const options = Object.create(null) as Record<string, IdentifierCaseOptionConfig>;
    Object.assign(options, baseIdentifierCaseOptions);

    options[IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_OPTION_NAME] = createStoreCapacityOptionConfig();
    options[IDENTIFIER_CASE_PROJECT_INDEX_CONCURRENCY_OPTION_NAME] = createConcurrencyOptionConfig();

    for (const scope of IDENTIFIER_CASE_SCOPE_NAMES) {
        options[getScopeOptionName(scope)] = createScopeOptionConfig(scope);
    }

    return options;
}

function createStoreCapacityOptionConfig(): IdentifierCaseOptionConfig {
    return createIdentifierCaseIntegerOptionConfig({
        defaultValue: DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES,
        minValue: 0,
        description:
            "Maximum number of identifier-case option store entries to retain. Set to 0 to disable eviction entirely."
    });
}

function createConcurrencyOptionConfig(): IdentifierCaseOptionConfig {
    return createIdentifierCaseIntegerOptionConfig({
        defaultValue: PROJECT_INDEX_GML_CONCURRENCY_BASELINE,
        minValue: 1,
        description:
            "Maximum number of GameMaker files parsed in parallel while building identifier-case project indexes."
    });
}

export const identifierCaseOptions = createIdentifierCaseOptions();

function normalizeList(optionName: string, value: unknown): string[] {
    return Core.normalizeStringList(value, {
        splitPattern: IDENTIFIER_CASE_LIST_SPLIT_PATTERN,
        errorMessage: `${optionName} must be provided as a string or array of strings.`
    });
}

function resolveScopeSettings(
    options: IdentifierCaseRawOptions,
    baseStyle: IdentifierCaseStyleValue
): {
    scopeSettings: Record<IdentifierCaseScope, IdentifierCaseScopeSetting>;
    scopeStyles: Record<IdentifierCaseScope, IdentifierCaseStyleValue>;
} {
    const scopeSettings = {} as Record<IdentifierCaseScope, IdentifierCaseScopeSetting>;
    const scopeStyles = {} as Record<IdentifierCaseScope, IdentifierCaseStyleValue>;

    for (const scope of IDENTIFIER_CASE_SCOPE_NAMES) {
        const optionName = getScopeOptionName(scope);
        const configuredValue = options[optionName];

        if (configuredValue === undefined || configuredValue === IDENTIFIER_CASE_INHERIT_VALUE) {
            scopeSettings[scope] = IDENTIFIER_CASE_INHERIT_VALUE;
            scopeStyles[scope] = baseStyle;
            continue;
        }

        const validatedStyle = requireIdentifierCaseStyle(configuredValue, optionName);
        scopeSettings[scope] = validatedStyle;
        scopeStyles[scope] = validatedStyle;
    }

    return { scopeSettings, scopeStyles };
}

export function normalizeIdentifierCaseOptions(options: IdentifierCaseRawOptions = {}) {
    const baseStyle = normalizeIdentifierCaseStyleOption(options[IDENTIFIER_CASE_BASE_OPTION_NAME], {
        optionName: IDENTIFIER_CASE_BASE_OPTION_NAME,
        defaultValue: IdentifierCaseStyle.OFF
    });
    const { scopeSettings, scopeStyles } = resolveScopeSettings(options, baseStyle);
    const ignorePatterns = normalizeList(
        IDENTIFIER_CASE_IGNORE_OPTION_NAME,
        options[IDENTIFIER_CASE_IGNORE_OPTION_NAME]
    );
    const preservedIdentifiers = normalizeList(
        IDENTIFIER_CASE_PRESERVE_OPTION_NAME,
        options[IDENTIFIER_CASE_PRESERVE_OPTION_NAME]
    );
    const assetRenamesAcknowledged = Boolean(options[IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME]);
    const effectiveAssetStyle = normalizeIdentifierCaseAssetStyle(scopeStyles.assets);
    scopeStyles.assets = effectiveAssetStyle;
    const assetRenamesEnabled = effectiveAssetStyle !== IdentifierCaseStyle.OFF;

    if (assetRenamesEnabled && !assetRenamesAcknowledged) {
        throw new Error(
            "Enabling gmlIdentifierCaseAssets requires acknowledging asset renames via gmlIdentifierCaseAcknowledgeAssetRenames."
        );
    }

    return {
        baseStyle,
        scopeSettings,
        scopeStyles,
        ignorePatterns,
        preservedIdentifiers,
        assetRenamesAcknowledged
    };
}

export function getIdentifierCaseScopeOptionName(scope: string): string {
    if (!IDENTIFIER_CASE_SCOPE_NAMES.includes(scope as IdentifierCaseScope)) {
        throw new RangeError(`Unknown identifier case scope: ${scope}`);
    }

    return getScopeOptionName(scope);
}
