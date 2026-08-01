import { Core } from "@gmloop/core";

import {
    defaultGmlFormatAdapterResolver,
    type GmlFormatAdapterResolver,
    type GmlFormatPrettierDefaults
} from "./default-format-adapters.js";
import { normalizeGmlFormatComponents } from "./format-component-normalizer.js";
import type { GmlFormatProvider } from "./format-provider.js";
import type { GmlFormatComponentBundle, GmlFormatComponentContract } from "./format-types.js";

/**
 * Default implementation bundle wiring the canonical parser, printer, and
 * comment handlers. This is the single point where concrete adapters are
 * assembled into the component contract.
 *
 * The contract now only exposes the helpers that the high-level Prettier
 * plugin wiring needs: the parser adapter, the printer entry point, the
 * `printComment`/`handleComments` Prettier callbacks, and the
 * `LogicalOperatorsStyle` map. The printer workspace imports the
 * remaining comment helpers (`printDanglingComments`,
 * `printDanglingCommentsAsGroup`) directly from
 * `../comments/comment-printer.js`; the previous
 * `printer/comment-print-boundary.ts` read-side indirection through
 * `options.gml` was a backward-compatibility shim with no remaining
 * callers and has been removed.
 * (target-state.md §2.3, §3.2)
 *
 * Adapter selection is delegated to {@link defaultGmlFormatAdapterResolver}
 * so this orchestration module never imports concrete low-level adapters
 * directly. The resolver contract is the single dependency-inversion seam
 * for the format workspace's high-level glue.
 */
export const defaultGmlFormatComponentImplementations: GmlFormatComponentContract = Object.freeze(
    defaultGmlFormatAdapterResolver.resolveAdapters()
);

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

const DEFAULT_PRETTIER_OPTIONS: GmlFormatPrettierDefaults = Object.freeze(
    defaultGmlFormatAdapterResolver.resolvePrettierDefaults()
);

/**
 * Default abstract provider consumed by the high-level Prettier plugin entry
 * point. Concrete parser, printer, comment, and normalization implementations
 * stay behind this component boundary so orchestration code depends only on the
 * provider contract.
 */
export const defaultGmlFormatProvider: GmlFormatProvider = Object.freeze({
    components: gmlFormatComponents,
    prettierDefaults: DEFAULT_PRETTIER_OPTIONS,
    normalizeFormattedOutput: defaultGmlFormatAdapterResolver.resolveNormalizeFormattedOutput()
});

export function createDefaultGmlFormatComponents(
    resolver: GmlFormatAdapterResolver = defaultGmlFormatAdapterResolver
): GmlFormatComponentBundle {
    const adapters = resolver.resolveAdapters();
    const logicalOperatorsStyle = adapters.LogicalOperatorsStyle;

    return {
        parsers: {
            "gml-parse": adapters.gmlParserAdapter
        },
        printers: {
            "gml-ast": {
                print: adapters.print,
                // Delegate the comment-classification predicates to the
                // canonical helpers owned by `@gmloop/core`. Centralising
                // these rules keeps the high-level Prettier wiring free of
                // ad-hoc AST shape checks and lets any embedded consumer
                // (or test) override the boundaries through the same
                // dependency-inversion seam that already governs the
                // parser, printer, and comment handlers.
                isBlockComment: Core.isBlockComment,
                canAttachComment: Core.canAttachComment,
                printComment: adapters.printComment,
                handleComments: adapters.handleComments
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
            inlineControlFlowBlockMargin: {
                since: "0.0.0",
                type: "int",
                category: "gml",
                default: 0,
                description:
                    "Buffer (in characters) added to the inline-length estimate for control-flow blocks before it is compared to `printWidth`. Positive values make the formatter more conservative (require additional headroom before a block is kept inline); negative values make it more aggressive (allow the inline form to exceed `printWidth` by the configured amount). Has no effect when `allowInlineControlFlowBlocks` is `false`."
            },
            logicalOperatorsStyle: {
                since: "0.0.0",
                type: "choice",
                category: "gml",
                default: logicalOperatorsStyle.KEYWORDS,
                description:
                    "Enforces a consistent logical operator style across the file. Each mode normalises every occurrence: 'keywords' converts all logical operators to word form; 'symbols' converts all to symbol form.",
                choices: [
                    {
                        value: logicalOperatorsStyle.KEYWORDS,
                        description:
                            "Enforce keyword form: `&&`, `||`, and `^^` are converted to `and`, `or`, and `xor`."
                    },
                    {
                        value: logicalOperatorsStyle.SYMBOLS,
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
