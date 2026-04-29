import type { GameMakerAstNode } from "@gmloop/core";

import { handleComments, printComment } from "../comments/index.js";
import { LogicalOperatorsStyle } from "../options/logical-operators-style.js";
import { gmlParserAdapter } from "../parsers/index.js";
import { print } from "../printer/index.js";
import { normalizeGmlFormatComponents } from "./format-component-normalizer.js";
import type { GmlFormatComponentBundle, GmlFormatComponentContract } from "./format-types.js";

/**
 * Default implementation bundle wiring the canonical parser, printer, and
 * comment handlers. This is the single point where concrete adapters are
 * assembled into the component contract.
 */
export const defaultGmlFormatComponentImplementations: GmlFormatComponentContract = Object.freeze({
    gmlParserAdapter,
    print,
    handleComments,
    printComment,
    LogicalOperatorsStyle
});

/**
 * The immutable, normalized format component bundle used by the GML Prettier plugin.
 * This constant is initialized once at module load time and never changes.
 *
 * Components include:
 * - Parsers for converting GML source to AST
 * - Printers for converting AST back to formatted GML
 * - Format options and their defaults
 */
export const gmlFormatComponents: GmlFormatComponentBundle = Object.freeze(
    normalizeGmlFormatComponents(createDefaultGmlFormatComponents())
);

export function createDefaultGmlFormatComponents(): GmlFormatComponentBundle {
    return {
        parsers: {
            "gml-parse": defaultGmlFormatComponentImplementations.gmlParserAdapter
        },
        printers: {
            "gml-ast": {
                print: defaultGmlFormatComponentImplementations.print,
                // Accept any for the runtime types coming from the AST and comment
                // helpers, satisfying TypeScript without adding deep imports.
                isBlockComment: (comment: GameMakerAstNode) => comment?.type === "CommentBlock",
                canAttachComment: (node: GameMakerAstNode) =>
                    node?.type && !node.type.includes("Comment") && node?.type !== "EmptyStatement",
                printComment: defaultGmlFormatComponentImplementations.printComment,
                handleComments: defaultGmlFormatComponentImplementations.handleComments
            }
        },
        options: {
            allowInlineControlFlowBlocks: {
                since: "0.0.0",
                type: "boolean",
                category: "gml",
                default: false,
                description:
                    "Allow short, comment-free braced control-flow blocks to stay on one line when the complete statement fits within printWidth (for example, 'if (condition) { return; }'). When disabled, control-flow blocks always expand across multiple lines."
            },
            logicalOperatorsStyle: {
                since: "0.0.0",
                type: "choice",
                category: "gml",
                default: LogicalOperatorsStyle.KEYWORDS,
                description:
                    "Enforces a consistent logical operator style across the file. Each mode normalises every occurrence: 'keywords' converts all logical operators to word form; 'symbols' converts all to symbol form.",
                choices: [
                    {
                        value: LogicalOperatorsStyle.KEYWORDS,
                        description:
                            "Enforce keyword form: `&&`, `||`, and `^^` are converted to `and`, `or`, and `xor`."
                    },
                    {
                        value: LogicalOperatorsStyle.SYMBOLS,
                        description:
                            "Enforce symbol form: `and`, `or`, and `xor` are converted to `&&`, `||`, and `^^`."
                    }
                ]
            }

            // Legacy whitespace toggles (preserveLineBreaks, maintainArrayIndentation,
            // maintainStructIndentation, maintainWithIndentation, maintainSwitchIndentation)
            // were intentionally removed so the formatter can enforce a single opinionated
            // indentation strategy. Avoid re-adding extraneous options that contradict that goal.
        }
    } as GmlFormatComponentBundle;
}
