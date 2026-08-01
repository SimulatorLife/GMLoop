import type { Rule } from "eslint";

import type { FeatherManifestEntry } from "./manifest.js";

/**
 * Matches a contiguous `enum NAME { ... }` block, including the surrounding
 * braces. Captures the raw text of the block so callers can run textual
 * rewrites against the block as a self-contained unit.
 */
export type EnumBlockMatch = {
    start: number;
    end: number;
    text: string;
};

/**
 * Matches a single `enum NAME { ... }` declaration by name. Mirrors
 * {@link EnumBlockMatch} but adds the parsed enum identifier so rule
 * implementations can dispatch on the enum name without re-parsing.
 */
export type EnumDeclarationMatch = {
    name: string;
    start: number;
    end: number;
    text: string;
};

/**
 * Segments produced by {@link splitMacroLineSegments} for a single macro
 * source line. The body is split into a continuation-free prefix plus the
 * trailing backslash marker, and any trailing inline comment is kept
 * separately so rewrites can preserve it.
 */
export type MacroLineSegments = Readonly<{
    bodyWithoutContinuation: string;
    continuationSuffix: string;
    commentSuffix: string;
    hasContinuation: boolean;
}>;

/**
 * Factory signature every feather rule module implements. Given a manifest
 * entry, returns a fully-formed ESLint rule module. The registry in
 * `create-feather-rule.ts` maps each `FeatherManifestEntry.id` to one of
 * these factories.
 */
export type FeatherRuleFactory = (entry: FeatherManifestEntry) => Rule.RuleModule;
