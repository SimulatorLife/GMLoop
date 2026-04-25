export {
    assertRenameRequest,
    assertValidIdentifierName,
    DEFAULT_RESERVED_KEYWORDS,
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
