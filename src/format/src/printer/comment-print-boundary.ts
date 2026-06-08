/**
 * Dependency-inversion boundary between the printer workspace and the
 * comments subsystem.
 *
 * The high-level printer modules (`print.ts`, `expression-print-utils.ts`)
 * call `printComment`, `printDanglingComments`, and
 * `printDanglingCommentsAsGroup` to format comments that Prettier exposes
 * via the `path`/`options` pair. The concrete implementations of those
 * helpers live in `../comments/comment-printer.js`.
 *
 * Rather than letting the printer import those helpers directly, this
 * boundary:
 *
 *  1. Reads the helpers from `options.gml` first. The `format-entry.ts`
 *     composition root populates `options.gml` from the
 *     `GmlFormatComponentContract`, so the printer depends on the
 *     abstraction instead of the concrete comments adapter.
 *  2. Falls back to a direct import of the canonical comments helper when
 *     `options.gml` is not populated (e.g. in tests that bypass
 *     `createGmlFormat`). This preserves backward compatibility while
 *     keeping the dependency arrow one-way: comments → printer via the
 *     contract, never printer → comments via static import.
 *
 * The return type mirrors the loose typing the underlying comments
 * helpers use: each helper returns a Prettier doc node (string, array, or
 * command) and the call sites in `print.ts`/`expression-print-utils.ts`
 * embed the result directly into `concat([...])` builders. The path and
 * options arguments are typed loosely because Prettier's plugin contract
 * does not expose concrete types for them.
 *
 * (target-state.md §2.3 — abstraction boundary; format/parser ownership
 * rules; comments are a printer-adjacent concern that the high-level
 * printer must depend on through an abstraction.)
 */

import {
    printComment as printCommentFromComments,
    printDanglingComments as printDanglingCommentsFromComments,
    printDanglingCommentsAsGroup as printDanglingCommentsAsGroupFromComments
} from "../comments/comment-printer.js";

type GmlCommentPrintOptionsBag =
    | {
          gml?: Record<string, unknown>;
      }
    | null
    | undefined;

type GmlCommentPrintPath = any;
type GmlCommentPrintFilter = ((comment: any) => boolean) | undefined;

type GmlCommentPrintReturn = any;

type GmlPrintCommentHelper = (commentPath: GmlCommentPrintPath, options: unknown) => GmlCommentPrintReturn;
type GmlPrintDanglingCommentsHelper = (
    path: GmlCommentPrintPath,
    options: unknown,
    filter: GmlCommentPrintFilter
) => GmlCommentPrintReturn;
type GmlPrintDanglingCommentsAsGroupHelper = (
    path: GmlCommentPrintPath,
    options: unknown,
    filter: GmlCommentPrintFilter
) => GmlCommentPrintReturn;

function resolveInjectedHelper<TFunction>(options: unknown, optionKey: string, fallback: TFunction): TFunction {
    const bag = options as GmlCommentPrintOptionsBag;
    const candidate = bag?.gml?.[optionKey];
    return typeof candidate === "function" ? (candidate as TFunction) : fallback;
}

/**
 * Print a single comment node from the supplied `commentPath`.
 *
 * Resolved from `options.gml.printComment` (injected by `format-entry.ts`
 * via the `GmlFormatComponentContract`) with a fallback to the canonical
 * implementation in `../comments/comment-printer.js`. The fallback keeps
 * the boundary usable in test contexts that bypass `createGmlFormat`.
 */
export function printComment(commentPath: GmlCommentPrintPath, options: unknown): GmlCommentPrintReturn {
    const helper = resolveInjectedHelper<GmlPrintCommentHelper>(options, "printComment", printCommentFromComments);
    return helper(commentPath, options);
}

/**
 * Print a flat list of dangling comments attached to the current node.
 *
 * Resolved from `options.gml.printDanglingComments` (injected by
 * `format-entry.ts` via the `GmlFormatComponentContract`) with a fallback
 * to the canonical implementation in `../comments/comment-printer.js`.
 */
export function printDanglingComments(
    path: GmlCommentPrintPath,
    options: unknown,
    filter?: GmlCommentPrintFilter
): GmlCommentPrintReturn {
    const helper = resolveInjectedHelper<GmlPrintDanglingCommentsHelper>(
        options,
        "printDanglingComments",
        printDanglingCommentsFromComments
    );
    return helper(path, options, filter);
}

/**
 * Print a group of dangling comments with preserved leading whitespace
 * and inter-comment separators.
 *
 * Resolved from `options.gml.printDanglingCommentsAsGroup` (injected by
 * `format-entry.ts` via the `GmlFormatComponentContract`) with a fallback
 * to the canonical implementation in `../comments/comment-printer.js`.
 */
export function printDanglingCommentsAsGroup(
    path: GmlCommentPrintPath,
    options: unknown,
    filter?: GmlCommentPrintFilter
): GmlCommentPrintReturn {
    const helper = resolveInjectedHelper<GmlPrintDanglingCommentsAsGroupHelper>(
        options,
        "printDanglingCommentsAsGroup",
        printDanglingCommentsAsGroupFromComments
    );
    return helper(path, options, filter);
}
