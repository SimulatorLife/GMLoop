/**
 * Source-text parsing helpers for `#region` / `#endregion` directives.
 *
 * Lint rules that need to reason about paired regions (for example
 * `require-region-pairs-rule` and `no-empty-regions-rule`) consume these
 * helpers through the `gmlRuleRegionDirectiveServices` facade in
 * `src/lint/src/rules/gml/gml-rule-services.js`. They live in the
 * `language/` directory because region directives are a parser-layer
 * concern (a small, GameMaker-specific front-matter syntax that the
 * foundation parser does not own), not a GML rule implementation. The
 * `rules/gml/` subtree is reserved for rule definitions and their
 * rule-shaped utilities.
 *
 * `RegionSourceLine` and `RegionDirectiveType` are exported here so they
 * can be re-exported through the rule-services facade without forcing
 * consumers to name the parser-layer file directly.
 */
export type RegionSourceLine = Readonly<{
    start: number;
    end: number;
    content: string;
    lineEnding: string;
}>;

/**
 * GameMaker region directive kind detected at the start of a source line.
 */
export type RegionDirectiveType = "start" | "end";

/**
 * Collects physical source lines while preserving source offsets and line
 * endings for deterministic single-file autofixes.
 *
 * @param sourceText Full GML source text.
 * @returns Physical line records in source order.
 */
export function collectRegionSourceLines(sourceText: string): ReadonlyArray<RegionSourceLine> {
    const lines: Array<RegionSourceLine> = [];
    const linePattern = /[^\r\n]*(?:\r\n|\n|$)/gu;
    let match = linePattern.exec(sourceText);

    while (match !== null) {
        const lineWithEnding = match[0] ?? "";
        if (lineWithEnding.length === 0) {
            break;
        }

        const hasCarriageReturnLineFeedEnding = lineWithEnding.endsWith("\r\n");
        const hasLineFeedEnding = !hasCarriageReturnLineFeedEnding && lineWithEnding.endsWith("\n");
        const lineEndingLength = hasCarriageReturnLineFeedEnding ? 2 : hasLineFeedEnding ? 1 : 0;

        const lineStart = match.index;
        const lineEnd = lineStart + lineWithEnding.length;
        const contentEnd = lineEnd - lineEndingLength;
        lines.push(
            Object.freeze({
                start: lineStart,
                end: lineEnd,
                content: sourceText.slice(lineStart, contentEnd),
                lineEnding: sourceText.slice(contentEnd, lineEnd)
            })
        );

        match = linePattern.exec(sourceText);
    }

    return Object.freeze(lines);
}

/**
 * Reads the region directive kind for canonical `#region` and `#endregion`
 * source lines. The directive may be indented and may include trailing text.
 *
 * @param lineContent Physical line text without its line ending.
 * @returns Directive kind, or `null` when the line is not a region directive.
 */
export function readRegionDirectiveType(lineContent: string): RegionDirectiveType | null {
    const trimmed = lineContent.trimStart();
    if (/^#region(?:\s|$)/u.test(trimmed)) {
        return "start";
    }

    if (/^#endregion(?:\s|$)/u.test(trimmed)) {
        return "end";
    }

    return null;
}

/**
 * Resolves the line ending used for synthesized region directive lines.
 *
 * @param lines Physical source lines collected from the file.
 * @returns First authored line ending, or LF when the file has no line ending.
 */
export function resolveRegionDirectiveLineEnding(lines: ReadonlyArray<RegionSourceLine>): string {
    for (const line of lines) {
        if (line.lineEnding.length > 0) {
            return line.lineEnding;
        }
    }

    return "\n";
}
