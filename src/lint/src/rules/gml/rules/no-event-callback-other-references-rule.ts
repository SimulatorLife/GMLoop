import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportProgramTextRewrite, rewriteSourceLines } from "../rule-base-helpers.js";

/**
 * Matches `other.<name>` member access anywhere in a line of GML source.
 *
 * The match is intentionally scoped to the textual source of an event file
 * because the underlying problem (`other` resolving to `undefined` inside
 * function expressions) only manifests inside event bodies, and the runtime
 * HTML5 surface for `other` differs from the desktop runtimes. The rule
 * therefore applies an opt-in filter on top of the standard `<event>/<file>`
 * pattern so non-event files (scripts, library files) are left alone.
 */
const OTHER_MEMBER_PATTERN = /\bother\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)/gu;

const EVENT_FILE_PATTERN = /(^|[\\/])objects[\\/][^\\/]+[\\/][^\\/]+\.gml$/u;

function isEventFilePath(sourcePath: string | undefined): boolean {
    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
        return false;
    }
    return EVENT_FILE_PATTERN.test(sourcePath);
}

/**
 * Detects whether a line of source text sits inside a function/arrow expression
 * nested in the event body. The rule is text-based; it cannot follow brace
 * depth, so a line that *opens* a function expression without yet showing
 * any `other.X` access may be skipped by the textual scan. The detection is
 * intentionally simple — it only marks a line as inside a callback if the
 * current function expression has already been opened and not yet closed.
 *
 * @param lines Source text split by line.
 * @param index Index of the line being scanned.
 * @returns True when the line at `index` is inside a function expression body.
 */
function isInsideFunctionExpression(lines: ReadonlyArray<string>, index: number): boolean {
    let depth = 0;
    for (let i = 0; i <= index; i += 1) {
        const line = lines[i] ?? "";
        for (let j = 0; j < line.length; j += 1) {
            const ch = line[j];
            if (ch === "{" && depth >= 0) {
                depth += 1;
            } else if (ch === "}") {
                depth = Math.max(0, depth - 1);
            }
        }
    }
    return depth > 0;
}

/**
 * Returns the `name` captured by the most recent `other.<name>` match, or
 * null when the line does not contain one. Resets the regex's lastIndex on
 * every call so a single source line is never re-scanned.
 */
function findOtherMemberMatch(line: string): string | null {
    OTHER_MEMBER_PATTERN.lastIndex = 0;
    const match = OTHER_MEMBER_PATTERN.exec(line);
    return match === null ? null : (match[1] ?? null);
}

/**
 * Creates the `gml/no-event-callback-other-references` rule.
 *
 * Reports every `other.<name>` member access that appears inside a function
 * expression nested in an event body. The HTML5 runtime does not propagate
 * the event's `other` to a closure scope, so the access reads `undefined`
 * and `vertex_submit`/texture-bound calls fail with cryptic
 * "Cannot read properties of undefined" errors. The `repairEventCallbackOther`
 * refactor codemod rewrites the same source.
 */
export function createNoEventCallbackOtherReferencesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText:
                "Replace `other.<name>` with `self.<name>` (or capture `self` into a local before the inline callback) when used inside a function expression in an event body — `other` is undefined inside the closure in the HTML5 runtime."
        }),
        create(context) {
            const sourcePath = context.filename;
            if (!isEventFilePath(sourcePath)) {
                return Object.freeze({});
            }
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, (sourceText) =>
                        rewriteSourceLines(sourceText, (line, index, lines) => {
                            if (!isInsideFunctionExpression(lines, index ?? 0)) {
                                return line;
                            }
                            const memberName = findOtherMemberMatch(line);
                            if (memberName === null) {
                                return line;
                            }
                            const update = context.sourceCode.getLocFromIndex(index ?? 0);
                            context.report({ loc: update, messageId: definition.messageId });
                            return line;
                        })
                    );
                }
            });
        }
    });
}
