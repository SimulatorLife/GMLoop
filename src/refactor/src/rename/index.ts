export {
    assertRenameRequest,
    assertValidIdentifierName,
    extractSymbolName,
    parseSymbolIdParts,
    tryNormalizeIdentifierName
} from "./identifier-validation.js";
export type { CrossRenameConfusion, DuplicateSymbolIdEntry, DuplicateTargetNameEntry } from "./rename-validation.js";
export {
    batchValidateScopeConflicts,
    detectCircularRenames,
    detectCrossRenameNameConfusion,
    detectDuplicateSourceSymbolIds,
    detectDuplicateTargetNames,
    detectRenameConflicts,
    validateCrossFileConsistency,
    validateRenameStructure
} from "./rename-validation.js";
export { loadRefactorReservedIdentifierNames } from "./reserved-identifiers.js";
