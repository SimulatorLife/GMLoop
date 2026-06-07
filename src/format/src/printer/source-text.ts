/**
 * Printer-side source text helpers.
 *
 * Originally lived in `src/format/src/printer/source-text.ts` but contained
 * general-purpose GML printer utilities (metadata resolution, blank line
 * detection, line terminator stripping) that belong in `@gmloop/core`'s text
 * domain alongside `src/core/src/text/source-text.ts`. Moving them into core
 * eliminates the duplication and keeps layout-focused utilities in the printer
 * while shared text utilities live in core.
 *
 * This file is kept as a shim to avoid breaking existing relative imports
 * within the printer subsystem. Call sites can migrate to importing directly
 * from `@gmloop/core` when convenient.
 */
import { Core } from "@gmloop/core";

// Re-export all printer-source-text helpers via the flattened Core namespace.
// The canonical implementations live in `@gmloop/core`'s text domain.
export const getOriginalTextFromOptions = Core.getOriginalTextFromOptions;
export const hasBlankLineBeforeLeadingComment = Core.hasBlankLineBeforeLeadingComment;
export const hasBlankLineBetweenLastCommentAndClosingBrace = Core.hasBlankLineBetweenLastCommentAndClosingBrace;
export const macroTextHasExplicitTrailingBlankLine = Core.macroTextHasExplicitTrailingBlankLine;
export const resolveNodeIndexRangeWithSource = Core.resolveNodeIndexRangeWithSource;
export const resolvePrinterSourceMetadata = Core.resolvePrinterSourceMetadata;
export const sliceOriginalText = Core.sliceOriginalText;
export const stripTrailingLineTerminators = Core.stripTrailingLineTerminators;
