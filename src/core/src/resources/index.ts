export type { FeatherDiagnostic, FeatherMetadata } from "./feather-metadata.js";
export {
    __normalizeFeatherMetadataForTests,
    clearFeatherMetadataCache,
    FEATHER_METADATA_PATH,
    FEATHER_METADATA_URL,
    getFeatherDiagnosticById,
    getFeatherDiagnostics,
    getFeatherMetadata,
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
    getIdentifierMetadata,
    GML_IDENTIFIER_METADATA_PATH,
    GML_IDENTIFIER_METADATA_URL,
    loadBundledIdentifierMetadata,
    loadDeprecatedIdentifierEntries,
    loadManualFunctionNames,
    loadReservedIdentifierNames,
    normalizeIdentifierMetadataEntries,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "./gml-identifier-loading.js";
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
