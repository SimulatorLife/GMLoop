/**
 * Canonical set of GML member-index accessor strings.
 *
 * PURPOSE: Centralises the finite set of valid `[…` accessor prefixes used in
 * `MemberIndexExpressionNode.accessor`. Branching on raw string literals scattered
 * across the codebase is error-prone (typos, unknown values). This module provides:
 *
 *   - A **typed enum object** (`MemberAccessor`) exposing each valid value.
 *   - A **readonly Set** (`MEMBER_INDEX_ACCESSORS`) for O(1) membership tests.
 *   - A **validator function** (`isMemberAccessor`) that narrows `string` to the
 *     concrete type so invalid values fail fast rather than silently falling through.
 *
 * VALID ACCESSORS (per GameMaker Language specification):
 *   - `[`   — default array / general DS accessor
 *   - `[#`  — grid DS accessor
 *   - `[?`  — map DS accessor
 *   - `[|`  — list DS accessor
 *   - `[@`  — stack DS accessor
 *   - `[$`  — priority queue DS accessor
 *
 * USAGE:
 *   ```ts
 *   import { MemberAccessor, isMemberAccessor, MEMBER_INDEX_ACCESSORS } from "@gmloop/core";
 *
 *   // Membership check
 *   if (MEMBER_INDEX_ACCESSORS.has(node.accessor)) { ... }
 *
 *   // Type narrowing
 *   if (isMemberAccessor(accessor)) {
 *       // accessor is narrowed to `MemberAccessor` here
 *   }
 *
 *   // Enum-style usage
 *   const accessor: MemberAccessor = "[#";
 *   ```
 */

export const MEMBER_ACCESSOR_ARRAY = "[";
export const MEMBER_ACCESSOR_GRID = "[#";
export const MEMBER_ACCESSOR_MAP = "[?";
export const MEMBER_ACCESSOR_LIST = "[|";
export const MEMBER_ACCESSOR_STACK = "[@";
export const MEMBER_ACCESSOR_PRIORITY_QUEUE = "[$";

/**
 * Union type of all valid member-index accessor strings.
 */
export type MemberAccessor =
    | typeof MEMBER_ACCESSOR_ARRAY
    | typeof MEMBER_ACCESSOR_GRID
    | typeof MEMBER_ACCESSOR_MAP
    | typeof MEMBER_ACCESSOR_LIST
    | typeof MEMBER_ACCESSOR_STACK
    | typeof MEMBER_ACCESSOR_PRIORITY_QUEUE;

/**
 * Canonical tuple of all valid accessor strings, in declaration order.
 * Intended for exhaustive switch statements.
 */
export const MEMBER_ACCESSOR_VALUES: readonly MemberAccessor[] = Object.freeze([
    MEMBER_ACCESSOR_ARRAY,
    MEMBER_ACCESSOR_GRID,
    MEMBER_ACCESSOR_MAP,
    MEMBER_ACCESSOR_LIST,
    MEMBER_ACCESSOR_STACK,
    MEMBER_ACCESSOR_PRIORITY_QUEUE
]);

/**
 * O(1) set for fast membership testing.
 */
export const MEMBER_INDEX_ACCESSORS: ReadonlySet<MemberAccessor> = new Set(
    MEMBER_ACCESSOR_VALUES
) as ReadonlySet<MemberAccessor>;

/**
 * Narrows an arbitrary string to `MemberAccessor` when the value is known to be valid.
 * Returns `false` for any string not in the canonical set, making invalid accessors
 * fail fast rather than silently proceeding with a broader type.
 */
export function isMemberAccessor(value: unknown): value is MemberAccessor {
    return typeof value === "string" && MEMBER_INDEX_ACCESSORS.has(value as MemberAccessor);
}
