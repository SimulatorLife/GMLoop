import { createEnumHelpers } from "../types.js";

/**
 * Supported GameMaker resource families for project add/remove transactions.
 */
export const ProjectResourceKind = Object.freeze({
    FONT: "font",
    OBJECT: "object",
    ROOM: "room",
    SCRIPT: "script",
    SOUND: "sound",
    SPRITE: "sprite"
});

/**
 * Runtime value union for {@link ProjectResourceKind}.
 */
export type ProjectResourceKindValue = (typeof ProjectResourceKind)[keyof typeof ProjectResourceKind];

const projectResourceKindHelpers = createEnumHelpers(ProjectResourceKind, "project resource kind");

/**
 * Check whether a value is a supported project resource kind.
 *
 * @param value - Candidate value to test.
 * @returns `true` when the value matches a supported resource kind.
 */
export function isProjectResourceKind(value: unknown): value is ProjectResourceKindValue {
    return projectResourceKindHelpers.is(value);
}

/**
 * Parse a resource kind string into a typed project resource kind value.
 *
 * @param value - Raw string or unknown input.
 * @returns Typed resource kind or `null` when unsupported.
 */
export function parseProjectResourceKind(value: unknown): ProjectResourceKindValue | null {
    return projectResourceKindHelpers.parse(value);
}

/**
 * Parse a resource kind string and throw when the value is unsupported.
 *
 * @param value - Raw resource kind input.
 * @param context - Optional context to include in the error message.
 * @returns Typed resource kind value.
 */
export function requireProjectResourceKind(value: unknown, context?: string): ProjectResourceKindValue {
    return projectResourceKindHelpers.require(value, context);
}
