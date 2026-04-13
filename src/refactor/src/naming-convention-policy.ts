import { Core } from "@gmloop/core";

import {
    assertRefactorConfigPlainObject,
    assertRefactorConfigPlainObjectWithAllowedKeys
} from "./refactor-config-assertions.js";
import type {
    NamingCaseStyle,
    NamingCategory,
    NamingConventionPolicy,
    NamingRuleConfig,
    ResolvedNamingConventionRules,
    ResolvedNamingRule
} from "./types.js";

export const NAMING_CASE_STYLES: ReadonlyArray<NamingCaseStyle> = Object.freeze([
    "lower",
    "upper",
    "camel",
    "lower_snake",
    "upper_snake",
    "pascal"
]);

export const NAMING_CATEGORY_PARENTS: Readonly<Record<NamingCategory, NamingCategory | null>> = Object.freeze({
    resource: null,
    scriptResourceName: "resource",
    objectResourceName: "resource",
    roomResourceName: "resource",
    spriteResourceName: "resource",
    audioResourceName: "resource",
    timelineResourceName: "resource",
    shaderResourceName: "resource",
    fontResourceName: "resource",
    pathResourceName: "resource",
    animationCurveResourceName: "resource",
    sequenceResourceName: "resource",
    tilesetResourceName: "resource",
    particleSystemResourceName: "resource",
    noteResourceName: "resource",
    extensionResourceName: "resource",
    variable: null,
    localVariable: "variable",
    globalVariable: "variable",
    instanceVariable: "variable",
    staticVariable: "variable",
    argument: "variable",
    catchArgument: "variable",
    loopIndexVariable: "localVariable",
    callable: null,
    function: "callable",
    typeName: null,
    structDeclaration: "typeName",
    constructorFunction: "structDeclaration",
    enum: "typeName",
    member: null,
    enumMember: "member",
    constant: null,
    macro: "constant"
});

type RuntimeResolvedNamingRule = ResolvedNamingRule & {
    enforceCaseStyle: boolean;
};

const NAMING_CATEGORY_SET = new Set(Object.keys(NAMING_CATEGORY_PARENTS));
const NAMING_CASE_STYLE_SET: ReadonlySet<string> = new Set(NAMING_CASE_STYLES);

const NAMING_RULE_CONFIG_ALLOWED_KEYS = new Set([
    "caseStyle",
    "prefix",
    "suffix",
    "minChars",
    "maxChars",
    "bannedPrefixes",
    "bannedSuffixes"
]);

const NAMING_CONVENTION_POLICY_ALLOWED_KEYS = new Set(["rules", "exclusivePrefixes", "exclusiveSuffixes"]);

function isNamingCategory(value: unknown): value is NamingCategory {
    return typeof value === "string" && NAMING_CATEGORY_SET.has(value);
}

function isNamingCaseStyle(value: unknown): value is NamingCaseStyle {
    return typeof value === "string" && NAMING_CASE_STYLE_SET.has(value);
}

function normalizeStringArray(value: unknown, context: string): Array<string> {
    const array = Core.assertArray(value, {
        errorMessage: `${context} must be an array`
    });

    return array.map((entry, index) => {
        if (typeof entry !== "string") {
            throw new TypeError(`${context}[${index}] must be a string, received ${typeof entry}`);
        }

        return entry;
    });
}

function normalizeNamingRuleConfig(config: unknown, context: string): NamingRuleConfig {
    const object = assertRefactorConfigPlainObjectWithAllowedKeys(config, NAMING_RULE_CONFIG_ALLOWED_KEYS, context);

    const normalized: NamingRuleConfig = {};

    if (object.caseStyle !== undefined) {
        if (!isNamingCaseStyle(object.caseStyle)) {
            throw new TypeError(`${context}.caseStyle must be one of ${NAMING_CASE_STYLES.join(", ")}`);
        }
        normalized.caseStyle = object.caseStyle;
    }

    if (object.prefix !== undefined) {
        if (typeof object.prefix !== "string") {
            throw new TypeError(`${context}.prefix must be a string`);
        }
        normalized.prefix = object.prefix;
    }

    if (object.suffix !== undefined) {
        if (typeof object.suffix !== "string") {
            throw new TypeError(`${context}.suffix must be a string`);
        }
        normalized.suffix = object.suffix;
    }

    if (object.minChars !== undefined) {
        if (!Number.isInteger(object.minChars) || (object.minChars as number) < 0) {
            throw new TypeError(`${context}.minChars must be a non-negative integer`);
        }
        normalized.minChars = object.minChars as number;
    }

    if (object.maxChars !== undefined) {
        if (!Number.isInteger(object.maxChars) || (object.maxChars as number) < 0) {
            throw new TypeError(`${context}.maxChars must be a non-negative integer`);
        }
        normalized.maxChars = object.maxChars as number;
    }

    if (
        normalized.minChars !== undefined &&
        normalized.maxChars !== undefined &&
        normalized.minChars > normalized.maxChars
    ) {
        throw new TypeError(`${context}.minChars must be less than or equal to ${context}.maxChars`);
    }

    if (object.bannedPrefixes !== undefined) {
        normalized.bannedPrefixes = normalizeStringArray(object.bannedPrefixes, `${context}.bannedPrefixes`);
    }

    if (object.bannedSuffixes !== undefined) {
        normalized.bannedSuffixes = normalizeStringArray(object.bannedSuffixes, `${context}.bannedSuffixes`);
    }

    return normalized;
}

function normalizeExclusiveAffixMap(value: unknown, context: string): Record<string, NamingCategory> | undefined {
    if (value === undefined) {
        return undefined;
    }

    const object = assertRefactorConfigPlainObject(value, context);
    const normalized: Record<string, NamingCategory> = {};

    for (const [affix, categoryValue] of Object.entries(object)) {
        if (!isNamingCategory(categoryValue)) {
            throw new TypeError(`${context}.${affix} must reference a known naming category`);
        }
        normalized[affix] = categoryValue;
    }

    return normalized;
}

/**
 * Normalize and validate a user-authored naming convention policy.
 */
export function normalizeNamingConventionPolicy(
    policy: NamingConventionPolicy | undefined,
    context = "namingConventionPolicy"
): NamingConventionPolicy {
    if (policy === undefined) {
        return {
            rules: {}
        };
    }

    const object = assertRefactorConfigPlainObjectWithAllowedKeys(
        policy,
        NAMING_CONVENTION_POLICY_ALLOWED_KEYS,
        context
    );

    const rulesObject = assertRefactorConfigPlainObject(object.rules ?? {}, `${context}.rules`);
    const rules: NamingConventionPolicy["rules"] = {};

    for (const [rawCategory, rawRule] of Object.entries(rulesObject)) {
        if (!isNamingCategory(rawCategory)) {
            throw new TypeError(`${context}.rules contains unknown category ${JSON.stringify(rawCategory)}`);
        }

        const category = rawCategory;
        rules[category] =
            rawRule === false ? false : normalizeNamingRuleConfig(rawRule, `${context}.rules.${category}`);
    }

    const exclusivePrefixes = normalizeExclusiveAffixMap(object.exclusivePrefixes, `${context}.exclusivePrefixes`);
    const exclusiveSuffixes = normalizeExclusiveAffixMap(object.exclusiveSuffixes, `${context}.exclusiveSuffixes`);

    return {
        rules,
        ...(exclusivePrefixes ? { exclusivePrefixes } : {}),
        ...(exclusiveSuffixes ? { exclusiveSuffixes } : {})
    };
}

function resolveRuleChain(
    policy: NamingConventionPolicy,
    category: NamingCategory
): Array<{ category: NamingCategory; rule: NamingRuleConfig | false }> {
    const chain: Array<{ category: NamingCategory; rule: NamingRuleConfig | false }> = [];
    let cursor: NamingCategory | null = category;

    while (cursor) {
        const rule = policy.rules[cursor];
        if (rule !== undefined) {
            chain.unshift({
                category: cursor,
                rule
            });
        }
        cursor = NAMING_CATEGORY_PARENTS[cursor];
    }

    return chain;
}

/**
 * Resolve inherited naming rules for every supported naming category.
 */
export function resolveNamingConventionRules(policy: NamingConventionPolicy): ResolvedNamingConventionRules {
    const resolved: ResolvedNamingConventionRules = {};

    for (const category of Object.keys(NAMING_CATEGORY_PARENTS) as Array<NamingCategory>) {
        const chain = resolveRuleChain(policy, category);
        if (chain.length === 0) {
            continue;
        }

        let disabled = false;
        let sawCaseStyle = false;
        const runtimeRule: RuntimeResolvedNamingRule = {
            prefix: "",
            suffix: "",
            caseStyle: "camel",
            enforceCaseStyle: false,
            minChars: null,
            maxChars: null,
            bannedPrefixes: [],
            bannedSuffixes: []
        };

        for (const entry of chain) {
            if (entry.rule === false) {
                disabled = true;
                break;
            }

            if (entry.rule.prefix !== undefined) {
                runtimeRule.prefix = entry.rule.prefix;
            }
            if (entry.rule.suffix !== undefined) {
                runtimeRule.suffix = entry.rule.suffix;
            }
            if (entry.rule.caseStyle !== undefined) {
                runtimeRule.caseStyle = entry.rule.caseStyle;
                sawCaseStyle = true;
            }
            if (entry.rule.minChars !== undefined) {
                runtimeRule.minChars = entry.rule.minChars;
            }
            if (entry.rule.maxChars !== undefined) {
                runtimeRule.maxChars = entry.rule.maxChars;
            }
            if (entry.rule.bannedPrefixes !== undefined) {
                // Keep the merged list unsorted here; it is sorted once after the
                // full inheritance chain is resolved.
                runtimeRule.bannedPrefixes = [...entry.rule.bannedPrefixes];
            }
            if (entry.rule.bannedSuffixes !== undefined) {
                // Keep the merged list unsorted here; it is sorted once after the
                // full inheritance chain is resolved.
                runtimeRule.bannedSuffixes = [...entry.rule.bannedSuffixes];
            }
        }

        if (!disabled) {
            runtimeRule.enforceCaseStyle = sawCaseStyle;
            runtimeRule.bannedPrefixes = [...runtimeRule.bannedPrefixes].sort((a, b) => b.length - a.length);
            runtimeRule.bannedSuffixes = [...runtimeRule.bannedSuffixes].sort((a, b) => b.length - a.length);
            resolved[category] = runtimeRule;
        }
    }

    return resolved;
}

function isWordDelimiter(character: string): boolean {
    return character === "_" || character === "-" || /\s/u.test(character);
}

function isUppercaseAscii(character: string): boolean {
    return character >= "A" && character <= "Z";
}

function isLowercaseAscii(character: string): boolean {
    return character >= "a" && character <= "z";
}

function splitIdentifierWords(value: string): Array<string> {
    if (value.length === 0) {
        return [];
    }

    let containsUppercase = false;
    let containsOtherDelimiters = false;
    let containsUnderscore = false;
    for (const character of value) {
        if (character === "_") {
            containsUnderscore = true;
            continue;
        }

        if (character === "-" || /\s/u.test(character)) {
            containsOtherDelimiters = true;
            break;
        }

        if (isUppercaseAscii(character)) {
            containsUppercase = true;
            if (containsUnderscore) {
                break;
            }
        }
    }

    if (!containsUppercase && !containsOtherDelimiters) {
        if (!containsUnderscore) {
            return [value.toLowerCase()];
        }

        const splitWords = value.split("_");
        const words: Array<string> = [];
        for (const splitWord of splitWords) {
            if (splitWord.length > 0) {
                words.push(splitWord.toLowerCase());
            }
        }
        return words;
    }

    const words: Array<string> = [];
    let currentWord = "";

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character === undefined) {
            continue;
        }

        if (isWordDelimiter(character)) {
            if (currentWord.length > 0) {
                words.push(currentWord);
                currentWord = "";
            }
            continue;
        }

        const previousCharacter = index > 0 ? value[index - 1] : undefined;
        const nextCharacter = index + 1 < value.length ? value[index + 1] : undefined;

        const startsCamelCaseBoundary =
            previousCharacter !== undefined && isLowercaseAscii(previousCharacter) && isUppercaseAscii(character);
        const startsAcronymBoundary =
            previousCharacter !== undefined &&
            nextCharacter !== undefined &&
            isUppercaseAscii(previousCharacter) &&
            isUppercaseAscii(character) &&
            isLowercaseAscii(nextCharacter);

        if ((startsCamelCaseBoundary || startsAcronymBoundary) && currentWord.length > 0) {
            words.push(currentWord);
            currentWord = character.toLowerCase();
            continue;
        }

        currentWord += character.toLowerCase();
    }

    if (currentWord.length > 0) {
        words.push(currentWord);
    }

    return words;
}

function capitalize(word: string): string {
    return word.length === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
}

function toCamelCase(words: ReadonlyArray<string>): string {
    if (words.length === 0) {
        return "";
    }

    // Use an index loop instead of words.slice(1) to avoid an intermediate array allocation.
    let formatted = words[0] ?? "";
    for (let i = 1; i < words.length; i++) {
        formatted += capitalize(words[i]);
    }

    return formatted;
}

function toPascalCase(words: ReadonlyArray<string>): string {
    let formatted = "";
    for (const word of words) {
        formatted += capitalize(word);
    }
    return formatted;
}

type IdentifierUnderscoreAffixes = {
    core: string;
    leading: string;
    trailing: string;
};

function isSimpleLowerSnakeCore(value: string): boolean {
    // Use a charCode loop instead of a regex to avoid the regex-engine overhead on every
    // identifier in the hot path.  Valid characters are a-z (97-122), 0-9 (48-57), and _ (95).
    const len = value.length;
    if (len === 0) {
        return false;
    }
    for (let i = 0; i < len; i++) {
        const code = value.charCodeAt(i);
        if ((code < 97 || code > 122) && (code < 48 || code > 57) && code !== 95) {
            return false;
        }
    }
    return true;
}

function toCamelCaseFromLowerSnakeCore(value: string): string {
    // Use an indexed charCode loop instead of for...of to avoid iterator allocation and
    // charCode comparisons to avoid per-character String.prototype calls.
    let formatted = "";
    let uppercaseNext = false;

    for (let i = 0, len = value.length; i < len; i++) {
        const code = value.charCodeAt(i);
        if (code === 95 /* "_" */) {
            uppercaseNext = true;
            continue;
        }

        // Uppercase the character when following an underscore and it's a-z (97–122).
        formatted +=
            uppercaseNext && code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : String.fromCharCode(code);
        uppercaseNext = false;
    }

    return formatted;
}

function splitIdentifierUnderscoreAffixes(value: string): IdentifierUnderscoreAffixes {
    // Use direct charCode comparisons instead of regex to avoid regex-engine overhead.
    // charCode 95 is "_".  Avoid slice() calls for the common case where leading/trailing
    // affix strings are empty (no underscore boundary characters present).
    const UNDERSCORE = 95;
    const len = value.length;
    let leadingEnd = 0;
    while (leadingEnd < len && value.charCodeAt(leadingEnd) === UNDERSCORE) {
        leadingEnd++;
    }

    if (leadingEnd === len) {
        // Entire value is underscores (or value is empty).
        return { leading: value, core: "", trailing: "" };
    }

    let trailingStart = len;
    while (trailingStart > leadingEnd && value.charCodeAt(trailingStart - 1) === UNDERSCORE) {
        trailingStart--;
    }

    return {
        leading: leadingEnd > 0 ? value.slice(0, leadingEnd) : "",
        core: value.slice(leadingEnd, trailingStart),
        trailing: trailingStart < len ? value.slice(trailingStart) : ""
    };
}

/**
 * Rewrite an identifier core into the requested naming case style.
 */
export function formatNamingCaseStyle(value: string, caseStyle: NamingCaseStyle): string {
    const underscoreAffixes = splitIdentifierUnderscoreAffixes(value);
    if (underscoreAffixes.core.length === 0) {
        return `${underscoreAffixes.leading}${underscoreAffixes.trailing}`;
    }

    if (isSimpleLowerSnakeCore(underscoreAffixes.core)) {
        if (caseStyle === "camel") {
            return `${underscoreAffixes.leading}${toCamelCaseFromLowerSnakeCore(underscoreAffixes.core)}${underscoreAffixes.trailing}`;
        }

        if (caseStyle === "lower_snake") {
            return `${underscoreAffixes.leading}${underscoreAffixes.core}${underscoreAffixes.trailing}`;
        }
    }

    const words = splitIdentifierWords(underscoreAffixes.core);

    if (words.length === 0) {
        return `${underscoreAffixes.leading}${underscoreAffixes.core}${underscoreAffixes.trailing}`;
    }

    const formattedCore =
        caseStyle === "lower"
            ? words.join("")
            : caseStyle === "upper"
              ? words.join("").toUpperCase()
              : caseStyle === "camel"
                ? toCamelCase(words)
                : caseStyle === "pascal"
                  ? toPascalCase(words)
                  : caseStyle === "lower_snake"
                    ? words.join("_")
                    : words.join("_").toUpperCase();

    return `${underscoreAffixes.leading}${formattedCore}${underscoreAffixes.trailing}`;
}

function attachesDirectlyToIdentifierCore(affix: string): boolean {
    return affix.length > 0 && /[A-Za-z0-9]$/u.test(affix);
}

function formatCoreNameForRule(coreName: string, rule: RuntimeResolvedNamingRule): string {
    if (rule.caseStyle === "camel" && attachesDirectlyToIdentifierCore(rule.prefix)) {
        return formatNamingCaseStyle(coreName, "pascal");
    }

    return formatNamingCaseStyle(coreName, rule.caseStyle);
}

function composeExpectedIdentifierName(coreName: string, rule: RuntimeResolvedNamingRule): string {
    const formattedCoreName = rule.enforceCaseStyle ? formatCoreNameForRule(coreName, rule) : coreName;
    return `${rule.prefix}${formattedCoreName}${rule.suffix}`;
}

function longestMatchingAffix(
    input: string,
    affixes: Record<string, NamingCategory> | undefined,
    position: "prefix" | "suffix"
): [string, NamingCategory] | null {
    if (!affixes) {
        return null;
    }

    let bestMatch: [string, NamingCategory] | null = null;
    for (const [affix, category] of Object.entries(affixes)) {
        const matches = position === "prefix" ? input.startsWith(affix) : input.endsWith(affix);
        if (!matches) {
            continue;
        }

        if (!bestMatch || affix.length > bestMatch[0].length) {
            bestMatch = [affix, category];
        }
    }

    return bestMatch;
}

function stripAffix(value: string, affix: string, position: "prefix" | "suffix"): string {
    if (affix.length === 0) {
        return value;
    }

    return position === "prefix" ? value.slice(affix.length) : value.slice(0, Math.max(0, value.length - affix.length));
}

/**
 * Strip a single affix direction (prefix or suffix) from `coreName`, using the same
 * three-priority resolution order for both directions:
 *   1. The rule's required affix takes precedence.
 *   2. An exclusive affix that belongs to a different category is stripped next.
 *   3. The longest matching banned affix is stripped as a last resort.
 *
 * `bannedAffixes` must already be sorted by descending length (longest first) so
 * this function can iterate them directly without allocating a sorted copy.
 */
function stripOneAffixDirection(
    coreName: string,
    ruleAffix: string,
    bannedAffixes: ReadonlyArray<string>,
    exclusiveAffixes: Record<string, NamingCategory> | undefined,
    position: "prefix" | "suffix",
    category: NamingCategory
): string {
    const isPrefix = position === "prefix";

    if (ruleAffix.length > 0) {
        const matches = isPrefix ? coreName.startsWith(ruleAffix) : coreName.endsWith(ruleAffix);
        if (matches) {
            return stripAffix(coreName, ruleAffix, position);
        }
    }

    const exclusive = longestMatchingAffix(coreName, exclusiveAffixes, position);
    if (exclusive && exclusive[1] !== category) {
        return stripAffix(coreName, exclusive[0], position);
    }

    // bannedAffixes is pre-sorted descending by length in resolveNamingConventionRules,
    // so we can iterate without creating an intermediate sorted copy.
    for (const banned of bannedAffixes) {
        if (banned.length > 0) {
            const matches = isPrefix ? coreName.startsWith(banned) : coreName.endsWith(banned);
            if (matches) {
                return stripAffix(coreName, banned, position);
            }
        }
    }

    if (isPrefix && ruleAffix.length >= 2 && ruleAffix.endsWith("_")) {
        const coreTargetPrefix = ruleAffix.slice(0, -1);
        const match = coreName.match(/^([a-z]+)(_|[A-Z])(.*)$/);

        if (match) {
            const prefixWord = match[1];
            const separator = match[2];
            const remainder = match[3];
            const separatorIsUpperCase = /[A-Z]/u.test(separator);

            if (
                prefixWord === coreTargetPrefix ||
                // When a target resource prefix extends a legacy short prefix word
                // (for example "oSpider" -> "obj_spider" or "sSpiderHead" -> "spr_spider_head"),
                // replace that old prefix instead of duplicating it in the result. This
                // single-letter branch is intentionally constrained to legacy prefixes
                // that match the first character of the configured target prefix.
                (prefixWord === coreTargetPrefix[0] && (separator === "_" || separatorIsUpperCase)) ||
                (prefixWord.length > 1 && coreTargetPrefix.startsWith(prefixWord))
            ) {
                return separator === "_" ? remainder : separator + remainder;
            }
        }
    }

    return coreName;
}

function stripKnownAffixes(
    currentName: string,
    rule: RuntimeResolvedNamingRule,
    policy: NamingConventionPolicy,
    category: NamingCategory
): string {
    const withoutPrefix = stripOneAffixDirection(
        currentName,
        rule.prefix,
        rule.bannedPrefixes,
        policy.exclusivePrefixes,
        "prefix",
        category
    );
    return stripOneAffixDirection(
        withoutPrefix,
        rule.suffix,
        rule.bannedSuffixes,
        policy.exclusiveSuffixes,
        "suffix",
        category
    );
}

function isSimpleCaseOnlyRule(rule: RuntimeResolvedNamingRule, policy: NamingConventionPolicy): boolean {
    return (
        rule.enforceCaseStyle &&
        rule.prefix.length === 0 &&
        rule.suffix.length === 0 &&
        rule.minChars === null &&
        rule.maxChars === null &&
        rule.bannedPrefixes.length === 0 &&
        rule.bannedSuffixes.length === 0 &&
        policy.exclusivePrefixes === undefined &&
        policy.exclusiveSuffixes === undefined
    );
}

/**
 * Evaluate a single identifier against the resolved naming policy.
 */
export function evaluateNamingConvention(
    currentName: string,
    category: NamingCategory,
    policy: NamingConventionPolicy,
    resolvedRules: ResolvedNamingConventionRules,
    options: {
        includeMessage?: boolean;
    } = {}
): { compliant: boolean; suggestedName: string | null; message: string | null } {
    const includeMessage = options.includeMessage !== false;
    const rule = resolvedRules[category] as RuntimeResolvedNamingRule | undefined;
    if (!rule) {
        return {
            compliant: true,
            suggestedName: currentName,
            message: null
        };
    }

    if (isSimpleCaseOnlyRule(rule, policy)) {
        const suggestedName = formatNamingCaseStyle(currentName, rule.caseStyle);
        if (suggestedName === currentName) {
            return {
                compliant: true,
                suggestedName: currentName,
                message: null
            };
        }

        return {
            compliant: false,
            suggestedName,
            message: includeMessage
                ? `Identifier ${JSON.stringify(currentName)} does not match ${rule.caseStyle} case.`
                : null
        };
    }

    let issueMessage: string | null = null;
    // When the case-style branch detects a violation it already computes the
    // expected name, so we capture it here to avoid a second identical call to
    // composeExpectedIdentifierName at the bottom of the function.
    let precomputedSuggestedName: string | undefined;
    const coreName = stripKnownAffixes(currentName, rule, policy, category);
    const exclusivePrefix = longestMatchingAffix(currentName, policy.exclusivePrefixes, "prefix");
    const exclusiveSuffix = longestMatchingAffix(currentName, policy.exclusiveSuffixes, "suffix");

    if (rule.bannedPrefixes.some((prefix) => prefix.length > 0 && currentName.startsWith(prefix))) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} uses a banned prefix for ${category}.`;
    } else if (rule.bannedSuffixes.some((suffix) => suffix.length > 0 && currentName.endsWith(suffix))) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} uses a banned suffix for ${category}.`;
    } else if (exclusivePrefix && exclusivePrefix[1] !== category) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} uses reserved prefix ${JSON.stringify(exclusivePrefix[0])}.`;
    } else if (exclusiveSuffix && exclusiveSuffix[1] !== category) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} uses reserved suffix ${JSON.stringify(exclusiveSuffix[0])}.`;
    } else if (rule.prefix.length > 0 && !currentName.startsWith(rule.prefix)) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} must start with ${JSON.stringify(rule.prefix)}.`;
    } else if (rule.suffix.length > 0 && !currentName.endsWith(rule.suffix)) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} must end with ${JSON.stringify(rule.suffix)}.`;
    } else if (rule.minChars !== null && coreName.length < rule.minChars) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} is shorter than the minimum core length ${rule.minChars}.`;
    } else if (rule.maxChars !== null && coreName.length > rule.maxChars) {
        issueMessage = `Identifier ${JSON.stringify(currentName)} exceeds the maximum core length ${rule.maxChars}.`;
    } else if (rule.enforceCaseStyle) {
        precomputedSuggestedName = composeExpectedIdentifierName(coreName, rule);
        if (precomputedSuggestedName !== currentName) {
            issueMessage = `Identifier ${JSON.stringify(currentName)} does not match ${rule.caseStyle} case.`;
        }
    }

    if (issueMessage === null) {
        return {
            compliant: true,
            suggestedName: currentName,
            message: null
        };
    }

    if (
        (rule.minChars !== null && coreName.length < rule.minChars) ||
        (rule.maxChars !== null && coreName.length > rule.maxChars)
    ) {
        return {
            compliant: false,
            suggestedName: null,
            message: issueMessage
        };
    }

    // Reuse the expected name already computed in the case-style branch when
    // available; otherwise compute it now for other violation types.
    const suggestedName = precomputedSuggestedName ?? composeExpectedIdentifierName(coreName, rule);

    return {
        compliant: suggestedName === currentName,
        suggestedName,
        message: includeMessage ? issueMessage : null
    };
}
