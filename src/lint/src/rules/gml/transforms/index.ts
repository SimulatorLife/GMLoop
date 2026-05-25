import { Core, type MutableGameMakerAstNode, type ParserTransform } from "@gmloop/core";

import { markCallsMissingArgumentSeparatorsTransform } from "./argument-mark-missing-separators.js";
import { annotateStaticFunctionOverridesTransform } from "./comment-annotate-static-overrides.js";

const { stripCommentsTransform } = Core;

/**
 * Central registry for parser transforms exposed by the plugin pipeline.
 * Each entry is referenced by name when `applyTransforms` runs, ensuring a single curated order.
 *
 * ORDER MATTERS:
 * 1. `annotateStaticFunctionOverridesTransform` – must run first so that
 *    `_overridesStaticFunction` annotations are present before any downstream
 *    pass (e.g., `synthetic-comments.ts`) reads them.
 * 2. `stripCommentsTransform` – removes comment nodes; must run before rules
 *    that expect a clean comment-free AST.
 * 3. `markCallsMissingArgumentSeparatorsTransform` – marks call-argument
 *    separator gaps; depends on the AST being otherwise normalized.
 */
const TRANSFORM_REGISTRY_ENTRIES = [
    annotateStaticFunctionOverridesTransform,
    stripCommentsTransform,
    markCallsMissingArgumentSeparatorsTransform
] as const;

type RegisteredTransform = (typeof TRANSFORM_REGISTRY_ENTRIES)[number];
export type ParserTransformName = RegisteredTransform["name"];
export type ParserTransformOptions = {
    readonly [Transform in RegisteredTransform as Transform["name"]]: Transform extends ParserTransform<
        MutableGameMakerAstNode,
        infer Options
    >
        ? Options
        : never;
};
type TransformByName = {
    [Transform in RegisteredTransform as Transform["name"]]: Transform;
};

const TRANSFORM_REGISTRY = {} as Record<string, RegisteredTransform>;
for (const transform of TRANSFORM_REGISTRY_ENTRIES) {
    if (Object.hasOwn(TRANSFORM_REGISTRY, transform.name)) {
        throw new Error(`Duplicate parser transform registered: ${transform.name}`);
    }

    TRANSFORM_REGISTRY[transform.name] = transform;
}

export function getParserTransform<Name extends ParserTransformName>(name: Name): TransformByName[Name] {
    const transform = TRANSFORM_REGISTRY[name];
    if (!transform) {
        throw new TypeError(`Unknown parser transform: ${String(name)}`);
    }

    return transform;
}

export function isParserTransformName(value: unknown): value is ParserTransformName {
    return typeof value === "string" && Object.hasOwn(TRANSFORM_REGISTRY, value);
}

/**
 * Apply the requested transforms in the curated order so the plugin can share a single normalization pipeline.
 */
export function applyTransforms(
    ast: MutableGameMakerAstNode,
    transformNames: readonly ParserTransformName[] = [],
    options: Readonly<Partial<Record<string, unknown>>> = {}
) {
    if (transformNames.length === 0) {
        return ast;
    }

    let current = ast;
    for (const name of transformNames) {
        const transform = getParserTransform(name) as {
            transform: (ast: MutableGameMakerAstNode, options?: unknown) => MutableGameMakerAstNode;
        };
        current = transform.transform(current, options[name]);
    }

    return current;
}

export const availableTransforms = TRANSFORM_REGISTRY_ENTRIES.map(
    (transform) => transform.name
) as readonly ParserTransformName[];

export { markCallsMissingArgumentSeparatorsTransform } from "./argument-mark-missing-separators.js";
export { annotateStaticFunctionOverridesTransform } from "./comment-annotate-static-overrides.js";
export {
    applySanitizedIndexAdjustments,
    conditionalAssignmentSanitizerTransform,
    sanitizeConditionalAssignments
} from "./conditional-assignment-sanitizer.js";
export { stripCommentsTransform };
export { CommentTracker } from "./comment-tracker.js";
export { evaluateTruthTablePolicy, TRUTH_TABLE_POLICY_BASELINE } from "./logical-expression-condensation-policy.js";
