/**
 * @file Re-export barrel for the autofix-printing contract.
 *
 * The canonical implementation lives in `src/contracts/autofix-printing.ts`.
 * This re-export exists for backward compatibility with existing imports from
 * this path. New code should import directly from the contracts layer or from
 * `gmlRuleAutofixServices` in `src/rules/gml/gml-rule-services.ts`.
 *
 * ARCHITECTURAL NOTE: This module is a backward-compatibility shim only.
 * It is scheduled for removal once all internal call sites have migrated.
 * Do not add new functionality here.
 */

// Re-export the canonical implementation from the contracts layer.
// Using a relative path up from language/ to contracts/.
export { printExpression, printNodeForAutofix, readNodeText } from "../contracts/autofix-printing.js";
