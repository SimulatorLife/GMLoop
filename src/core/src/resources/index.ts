export type { FeatherDiagnostic, FeatherMetadata } from "./feather-metadata.js";
export {
    __normalizeFeatherMetadataForTests,
    clearFeatherMetadataCache,
    getFeatherDiagnosticById,
    getFeatherDiagnostics,
    getFeatherMetadata,
    getFeatherMetadataPath,
    getFeatherMetadataUrl,
    loadBundledFeatherMetadata
} from "./feather-metadata.js";
export type {
    DeprecatedIdentifierDiagnosticOwner,
    DeprecatedIdentifierLegacyUsage,
    DeprecatedIdentifierMetadataEntry,
    DeprecatedIdentifierReplacementKind
} from "./gml-identifier-loading.js";
export {
    clearIdentifierMetadataCache,
    getGmlIdentifierMetadataPath,
    getGmlIdentifierMetadataUrl,
    getIdentifierMetadata,
    loadBundledIdentifierMetadata,
    loadDeprecatedIdentifierEntries,
    loadManualFunctionNames,
    loadReservedIdentifierNames,
    normalizeIdentifierMetadataEntries,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "./gml-identifier-loading.js";
export type { GmlBindingIdentifierContext } from "./gml-identifier-reservation.js";
export {
    isReservedGmlBindingIdentifierName,
    loadReservedGmlBindingIdentifierNames
} from "./gml-identifier-reservation.js";
export type { ProjectMetadataSchemaName } from "./project-metadata.js";
export {
    applyProjectMetadataStringMutations,
    findProjectMetadataValueTextRange,
    getProjectMetadataValueAtPath,
    isProjectMetadataParseError,
    isProjectMetadataSchemaValidationError,
    parseProjectMetadataDocument,
    parseProjectMetadataDocumentForMutation,
    parseProjectMetadataDocumentWithSchema,
    readProjectMetadataDocumentForMutationFromFile,
    readProjectMetadataDocumentFromFile,
    resolveProjectMetadataSchemaName,
    stringifyProjectMetadataDocument,
    updateProjectMetadataReferenceByPath,
    writeProjectMetadataDocumentToFile
} from "./project-metadata.js";
export { resolveBundledResourcePath, resolveBundledResourceUrl } from "./resource-locator.js";
