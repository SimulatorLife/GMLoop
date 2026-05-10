import { Core } from "@gmloop/core";

import { normalizeParamDocType } from "./index.js";
import {
    getArgumentIndexFromIdentifier,
    getIdentifierFromParameterNode,
    getParameterDocInfo,
    getSourceTextForNode,
    type ImplicitArgumentDocEntry,
    preferredParamDocNamesByNode,
    shouldOmitUndefinedDefaultForFunctionNode,
    suppressedImplicitDocCanonicalByNode,
    type SyntheticDocGenerationOptions
} from "./synthetic-helpers.js";

const {
    docParamNamesLooselyEqual,
    getCanonicalParamNameFromText,
    isNonEmptyTrimmedString,
    isOptionalParamDocName,
    isUndefinedSentinel,
    preservedUndefinedDefaultParameters,
    synthesizedUndefinedDefaultParameters
} = Core;

const STRING_TYPE = "string";
const NUMBER_TYPE = "number";

export type DocMeta = {
    tag: string;
    name?: string | null;
    type?: string | null;
    description?: string | null;
};

type AppendExplicitParameterDocLinesParams = {
    lines: string[];
    node: any;
    options: SyntheticDocGenerationOptions;
    documentedParamNames: Set<unknown>;
    orderedParamMetadata: readonly DocMeta[];
    paramMetadataByCanonical: Map<string, DocMeta>;
    implicitDocEntryByIndex: Map<number, ImplicitArgumentDocEntry>;
};

type AppendExplicitParameterDocLineParams = {
    lines: string[];
    documentedParamNames: Set<unknown>;
    docName: string;
    docType: string | null;
    existingMetadata: DocMeta | null;
    implicitName: string | null;
    ordinalMetadata: DocMeta | null;
    isOrphanedImplicit: boolean;
    isAdoptingOrdinal: boolean;
    implicitDocEntry: ImplicitArgumentDocEntry | undefined;
};

type AppendImplicitArgumentDocLinesParams = {
    lines: string[];
    node: any;
    documentedParamNames: Set<unknown>;
    orderedParamMetadata: readonly DocMeta[];
    implicitArgumentDocNames: readonly ImplicitArgumentDocEntry[];
};

type OrdinalDocPreferencesParams = {
    node: any;
    paramInfo: ReturnType<typeof getParameterDocInfo>;
    paramIndex: number;
    options: SyntheticDocGenerationOptions;
    shouldAdoptOrdinalName: boolean;
    hasCompleteOrdinalDocs: boolean;
    canonicalOrdinal: string | null;
    canonicalParamName: string | null;
    rawOrdinalName: string | null;
    paramMetadataByCanonical: Map<string, DocMeta>;
    implicitDocEntryByIndex: Map<number, ImplicitArgumentDocEntry>;
};

type ImplicitNameOverrideParams = {
    node: any;
    paramIndex: number;
    implicitDocEntry: ImplicitArgumentDocEntry | undefined;
    canonicalOrdinal: string | null;
    ordinalDocName: string | null;
    effectiveImplicitName: string | null;
    fallbackCanonical: string | null;
};

type OptionalDocStateParams = {
    node: any;
    param: any;
    paramIndex: number;
    paramInfo: ReturnType<typeof getParameterDocInfo>;
    options: SyntheticDocGenerationOptions;
    existingMetadata: DocMeta | null;
    serializedDocName: string | undefined;
};

function applyOrdinalImplicitDocEntryOverrides(
    node: any,
    paramIndex: number,
    implicitDocEntry: ImplicitArgumentDocEntry | undefined,
    canonicalOrdinal: string | null,
    ordinalDocName: string | null
) {
    if (!implicitDocEntry) {
        return;
    }

    implicitDocEntry._suppressDocLine = true;

    if (implicitDocEntry.canonical && node) {
        let suppressedCanonicals = suppressedImplicitDocCanonicalByNode.get(node);
        if (!suppressedCanonicals) {
            suppressedCanonicals = new Set();
            suppressedImplicitDocCanonicalByNode.set(node, suppressedCanonicals);
        }
        suppressedCanonicals.add(implicitDocEntry.canonical);
    }

    if (canonicalOrdinal) {
        implicitDocEntry.canonical = canonicalOrdinal;
    }

    if (!ordinalDocName) {
        return;
    }

    implicitDocEntry.name = ordinalDocName;
    if (node) {
        let preferredDocs = preferredParamDocNamesByNode.get(node);
        if (!preferredDocs) {
            preferredDocs = new Map();
            preferredParamDocNamesByNode.set(node, preferredDocs);
        }
        preferredDocs.set(paramIndex, ordinalDocName);
    }
}

function appendExplicitParameterDocLine({
    lines,
    documentedParamNames,
    docName,
    docType,
    existingMetadata,
    implicitName,
    ordinalMetadata,
    isOrphanedImplicit,
    isAdoptingOrdinal,
    implicitDocEntry
}: AppendExplicitParameterDocLineParams) {
    if (documentedParamNames.has(docName) && !isOrphanedImplicit && !isAdoptingOrdinal) {
        if (existingMetadata) {
            const typePart = existingMetadata.type ? `{${existingMetadata.type}} ` : "";
            const descriptionPart = existingMetadata.description ?? "";
            const separator = descriptionPart ? " - " : "";
            const line = `/// @param ${typePart}${docName}${separator}${descriptionPart}`;
            lines.push(line.trimEnd());
        } else if (implicitName && docName === implicitName && !existingMetadata && !ordinalMetadata) {
            const line = `/// @param ${docName}`;
            lines.push(line);
        }

        if (implicitDocEntry?.name) {
            documentedParamNames.add(implicitDocEntry.name);
        }
        return;
    }

    documentedParamNames.add(docName);
    const typePart = docType ? `{${docType}} ` : "";
    const descriptionPart = existingMetadata?.description ?? ordinalMetadata?.description ?? "";
    const separator = descriptionPart ? " - " : "";
    const newLine = `/// @param ${typePart}${docName}${separator}${descriptionPart}`;
    lines.push(newLine);
}

function handleOrdinalDocPreferences({
    node,
    paramInfo,
    paramIndex,
    options,
    shouldAdoptOrdinalName,
    hasCompleteOrdinalDocs,
    canonicalOrdinal,
    canonicalParamName,
    rawOrdinalName,
    paramMetadataByCanonical,
    implicitDocEntryByIndex
}: OrdinalDocPreferencesParams) {
    if (hasCompleteOrdinalDocs && node && typeof paramIndex === NUMBER_TYPE && shouldAdoptOrdinalName) {
        const documentedParamCanonical = getCanonicalParamNameFromText(paramInfo.name) ?? null;
        if (documentedParamCanonical && paramMetadataByCanonical.has(documentedParamCanonical)) {
            // The parameter already appears in the documented metadata;
            // avoid overriding it with mismatched ordinal ordering.
        } else {
            let preferredDocs = preferredParamDocNamesByNode.get(node);
            if (!preferredDocs) {
                preferredDocs = new Map();
                preferredParamDocNamesByNode.set(node, preferredDocs);
            }
            if (!preferredDocs.has(paramIndex)) {
                preferredDocs.set(paramIndex, rawOrdinalName);
            }
        }
    }

    if (
        !shouldAdoptOrdinalName &&
        canonicalOrdinal &&
        canonicalParamName &&
        canonicalOrdinal !== canonicalParamName &&
        node &&
        !paramMetadataByCanonical.has(canonicalParamName)
    ) {
        const canonicalOrdinalMatchesDeclaredParam = Array.isArray(node?.params)
            ? node.params.some((candidate: any, candidateIndex: number) => {
                  if (candidateIndex === paramIndex) {
                      return false;
                  }

                  const candidateInfo = getParameterDocInfo(candidate, node, options);
                  const candidateCanonical = candidateInfo?.name
                      ? getCanonicalParamNameFromText(candidateInfo.name)
                      : null;

                  return candidateCanonical === canonicalOrdinal;
              })
            : false;

        const canonicalOrdinalMatchesImplicitAlias =
            implicitDocEntryByIndex &&
            Array.from(implicitDocEntryByIndex.values()).some((entry) => entry.name === canonicalOrdinal);

        if (canonicalOrdinalMatchesDeclaredParam || canonicalOrdinalMatchesImplicitAlias) {
            // Preserve canonical ordinal names when they match declared parameters or aliases.
        } else {
            let suppressedCanonicals = suppressedImplicitDocCanonicalByNode.get(node);
            if (!suppressedCanonicals) {
                suppressedCanonicals = new Set();
                suppressedImplicitDocCanonicalByNode.set(node, suppressedCanonicals);
            }
            suppressedCanonicals.add(canonicalOrdinal);
        }
    }
}

function applyImplicitNameOverride({
    node,
    paramIndex,
    implicitDocEntry,
    canonicalOrdinal,
    ordinalDocName,
    effectiveImplicitName,
    fallbackCanonical
}: ImplicitNameOverrideParams) {
    if (!effectiveImplicitName || !ordinalDocName) {
        return effectiveImplicitName;
    }

    const canonicalImplicit = getCanonicalParamNameFromText(effectiveImplicitName) ?? null;
    const resolvedFallbackCanonical = fallbackCanonical;
    const shouldOverrideImplicitName = Boolean(
        canonicalOrdinal && canonicalOrdinal !== resolvedFallbackCanonical && canonicalOrdinal !== canonicalImplicit
    );

    if (!shouldOverrideImplicitName) {
        return effectiveImplicitName;
    }

    const ordinalLength = canonicalOrdinal.length;
    const implicitCanonicalLength = canonicalImplicit?.length ?? 0;
    const hasImplicitName = implicitCanonicalLength > 0 || isNonEmptyTrimmedString(effectiveImplicitName);
    const implicitComparisonLength = hasImplicitName ? implicitCanonicalLength : 0;

    if (ordinalLength > implicitComparisonLength) {
        applyOrdinalImplicitDocEntryOverrides(node, paramIndex, implicitDocEntry, canonicalOrdinal, ordinalDocName);
        return null;
    }

    return effectiveImplicitName;
}

function computeOptionalDocState({
    node,
    param,
    paramIndex,
    paramInfo,
    options,
    existingMetadata,
    serializedDocName
}: OptionalDocStateParams) {
    const optionalOverrideFlag = paramInfo?.optionalOverride === true;
    const defaultIsUndefined = param?.type === "DefaultParameter" && isUndefinedSentinel(param.right);
    const shouldOmitUndefinedDefault = defaultIsUndefined && shouldOmitUndefinedDefaultForFunctionNode(node);
    const hasExistingMetadata = Boolean(existingMetadata);
    const hasOptionalDocName = param?.type === "DefaultParameter" && isOptionalParamDocName(serializedDocName);
    const parameterSourceText = getSourceTextForNode(param, options);
    const defaultCameFromSource =
        defaultIsUndefined && typeof parameterSourceText === STRING_TYPE && parameterSourceText.includes("=");

    const explicitOptionalMarker = param?._featherOptionalParameter === true;

    let shouldMarkOptional =
        Boolean(paramInfo.optional) ||
        hasOptionalDocName ||
        (param?.type === "DefaultParameter" &&
            isUndefinedSentinel(param.right) &&
            (explicitOptionalMarker || node?.type === "ConstructorDeclaration"));
    const hasSiblingExplicitDefault = Array.isArray(node?.params)
        ? node.params.some((candidate: any, candidateIndex: number) => {
              if (candidateIndex === paramIndex || !candidate) {
                  return false;
              }

              if (candidate.type !== "DefaultParameter") {
                  return false;
              }

              return candidate.right != null && !isUndefinedSentinel(candidate.right);
          })
        : false;
    const hasPriorExplicitDefault = Array.isArray(node?.params)
        ? node.params.slice(0, paramIndex).some((candidate: any) => {
              if (!candidate || candidate.type !== "DefaultParameter") {
                  return false;
              }

              return candidate.right != null && !isUndefinedSentinel(candidate.right);
          })
        : false;
    const shouldApplyOptionalSuppression = hasExistingMetadata || !hasSiblingExplicitDefault;

    const materializedFromExplicitLeft = param?._featherMaterializedFromExplicitLeft === true;
    if (
        !shouldMarkOptional &&
        !hasExistingMetadata &&
        hasSiblingExplicitDefault &&
        hasPriorExplicitDefault &&
        !materializedFromExplicitLeft &&
        param?._featherMaterializedTrailingUndefined !== true
    ) {
        shouldMarkOptional = true;
    }
    if (shouldApplyOptionalSuppression) {
        if (
            shouldMarkOptional &&
            defaultIsUndefined &&
            shouldOmitUndefinedDefault &&
            paramInfo?.explicitUndefinedDefault === true &&
            !optionalOverrideFlag &&
            !hasOptionalDocName
        ) {
            shouldMarkOptional = false;
        }
        if (
            shouldMarkOptional &&
            shouldOmitUndefinedDefault &&
            paramInfo.optional &&
            defaultCameFromSource &&
            !hasOptionalDocName
        ) {
            shouldMarkOptional = false;
        }
    }
    if (shouldMarkOptional && param?.type === "Identifier" && !synthesizedUndefinedDefaultParameters.has(param)) {
        synthesizedUndefinedDefaultParameters.add(param);
    }
    if (shouldMarkOptional && defaultIsUndefined) {
        preservedUndefinedDefaultParameters.add(param);
    }

    return shouldMarkOptional;
}

function appendExplicitParameterDocLines({
    lines,
    node,
    options,
    documentedParamNames,
    orderedParamMetadata,
    paramMetadataByCanonical,
    implicitDocEntryByIndex
}: AppendExplicitParameterDocLinesParams) {
    for (const [paramIndex, param] of (node.params ?? []).entries()) {
        const paramInfo = getParameterDocInfo(param, node, options);
        if (!paramInfo || !paramInfo.name) {
            continue;
        }
        const ordinalMetadata =
            Number.isInteger(paramIndex) && paramIndex >= 0 ? (orderedParamMetadata[paramIndex] ?? null) : null;
        const rawOrdinalName =
            typeof ordinalMetadata?.name === STRING_TYPE && ordinalMetadata.name.length > 0
                ? ordinalMetadata.name
                : null;
        const canonicalOrdinal = rawOrdinalName ? getCanonicalParamNameFromText(rawOrdinalName) : null;
        const implicitDocEntry = implicitDocEntryByIndex.get(paramIndex);
        const paramIdentifier = getIdentifierFromParameterNode(param);
        const paramIdentifierName = typeof paramIdentifier?.name === STRING_TYPE ? paramIdentifier.name : null;
        const isGenericArgumentName =
            typeof paramIdentifierName === STRING_TYPE && getArgumentIndexFromIdentifier(paramIdentifierName) !== null;

        const implicitName =
            implicitDocEntry &&
            typeof implicitDocEntry.name === STRING_TYPE &&
            implicitDocEntry.name &&
            (implicitDocEntry.canonical !== implicitDocEntry.fallbackCanonical ||
                implicitDocEntry.name !== implicitDocEntry.canonical)
                ? implicitDocEntry.name
                : null;

        const canonicalParamName =
            (implicitDocEntry?.canonical && implicitDocEntry.canonical) ||
            getCanonicalParamNameFromText(paramInfo.name);
        const existingMetadata =
            (canonicalParamName &&
                paramMetadataByCanonical.has(canonicalParamName) &&
                paramMetadataByCanonical.get(canonicalParamName)) ||
            null;
        const existingDocName = existingMetadata?.name;
        const hasCompleteOrdinalDocs =
            Array.isArray(node?.params) && orderedParamMetadata.length === node.params.length;
        const canonicalOrdinalMatchesParam =
            Boolean(canonicalOrdinal) &&
            Boolean(canonicalParamName) &&
            (canonicalOrdinal === canonicalParamName ||
                docParamNamesLooselyEqual(canonicalOrdinal, canonicalParamName));

        const ordinalNameMatchesOtherParamAlias =
            Boolean(rawOrdinalName) &&
            Array.from(implicitDocEntryByIndex.values()).some(
                (entry) => entry.index !== paramIndex && entry.name === rawOrdinalName
            );

        const shouldAdoptOrdinalName =
            Boolean(rawOrdinalName) &&
            (canonicalOrdinalMatchesParam || isGenericArgumentName) &&
            !ordinalNameMatchesOtherParamAlias;

        handleOrdinalDocPreferences({
            node,
            paramInfo,
            paramIndex,
            options,
            shouldAdoptOrdinalName,
            hasCompleteOrdinalDocs,
            canonicalOrdinal,
            canonicalParamName,
            rawOrdinalName,
            paramMetadataByCanonical,
            implicitDocEntryByIndex
        });
        const ordinalDocName =
            hasCompleteOrdinalDocs && (!existingDocName || existingDocName.length === 0) && shouldAdoptOrdinalName
                ? rawOrdinalName
                : null;
        let effectiveImplicitName = implicitName;
        effectiveImplicitName = applyImplicitNameOverride({
            node,
            paramIndex,
            implicitDocEntry,
            canonicalOrdinal,
            ordinalDocName,
            effectiveImplicitName,
            fallbackCanonical: implicitDocEntry?.fallbackCanonical ?? getCanonicalParamNameFromText(paramInfo.name)
        });

        const baseDocName =
            (effectiveImplicitName && effectiveImplicitName.length > 0 && effectiveImplicitName) ||
            (ordinalDocName && ordinalDocName.length > 0 && ordinalDocName) ||
            paramInfo.name;

        const shouldMarkOptional = computeOptionalDocState({
            node,
            param,
            paramIndex,
            paramInfo,
            options,
            existingMetadata,
            serializedDocName: existingDocName
        });

        const docName = shouldMarkOptional ? `[${baseDocName}]` : baseDocName;

        const normalizedExistingType = normalizeParamDocType(existingMetadata?.type);
        const normalizedOrdinalType = normalizeParamDocType(ordinalMetadata?.type);
        const docType = normalizedExistingType ?? normalizedOrdinalType;

        const isOrphanedImplicit = implicitName && docName === implicitName && !existingMetadata;
        const isAdoptingOrdinal = shouldAdoptOrdinalName && docName === rawOrdinalName && !existingMetadata;
        appendExplicitParameterDocLine({
            lines,
            documentedParamNames,
            docName,
            docType,
            existingMetadata,
            implicitName,
            ordinalMetadata,
            isOrphanedImplicit,
            isAdoptingOrdinal,
            implicitDocEntry
        });
    }
}

function appendImplicitArgumentDocLines({
    lines,
    node,
    documentedParamNames,
    orderedParamMetadata,
    implicitArgumentDocNames
}: AppendImplicitArgumentDocLinesParams) {
    for (const entry of implicitArgumentDocNames) {
        if (!entry || entry._suppressDocLine) {
            continue;
        }

        const { name: docName, index, canonical, fallbackCanonical } = entry;
        const isImplicitFallbackEntry = canonical === fallbackCanonical;
        let declaredParamIsGeneric = false;
        if (Array.isArray(node?.params) && Number.isInteger(index) && index >= 0) {
            const decl = node.params[index];
            const declId = getIdentifierFromParameterNode(decl);
            if (declId && typeof declId.name === STRING_TYPE) {
                declaredParamIsGeneric = getArgumentIndexFromIdentifier(declId.name) !== null;
            }
        }
        const isFallbackEntry = canonical === fallbackCanonical;
        if (
            isFallbackEntry &&
            Number.isInteger(index) &&
            orderedParamMetadata[index] &&
            typeof orderedParamMetadata[index].name === STRING_TYPE &&
            orderedParamMetadata[index].name.length > 0
        ) {
            continue;
        }

        if (documentedParamNames.has(docName)) {
            if (
                canonical &&
                fallbackCanonical &&
                canonical !== fallbackCanonical &&
                entry.hasDirectReference === true &&
                !documentedParamNames.has(fallbackCanonical) &&
                !declaredParamIsGeneric &&
                Array.isArray(node?.params) &&
                Number.isInteger(index) &&
                index >= 0 &&
                index < node.params.length
            ) {
                documentedParamNames.add(fallbackCanonical);
                lines.push(`/// @param ${fallbackCanonical}`);
            }
            continue;
        }

        if (
            isImplicitFallbackEntry &&
            Number.isInteger(index) &&
            orderedParamMetadata[index] &&
            typeof orderedParamMetadata[index].name === STRING_TYPE &&
            orderedParamMetadata[index].name.length > 0
        ) {
            continue;
        }

        documentedParamNames.add(docName);
        lines.push(`/// @param ${docName}`);

        if (
            canonical &&
            fallbackCanonical &&
            canonical !== fallbackCanonical &&
            entry.hasDirectReference === true &&
            !documentedParamNames.has(fallbackCanonical) &&
            Number.isInteger(index) &&
            index >= 0 &&
            !declaredParamIsGeneric
        ) {
            documentedParamNames.add(fallbackCanonical);
            lines.push(`/// @param ${fallbackCanonical}`);
        }
    }
}

export function appendDocumentedParamLines(
    lines: string[],
    node: any,
    options: SyntheticDocGenerationOptions,
    documentedParamNames: Set<unknown>,
    orderedParamMetadata: readonly DocMeta[],
    paramMetadataByCanonical: Map<string, DocMeta>,
    implicitDocEntryByIndex: Map<number, ImplicitArgumentDocEntry>,
    implicitArgumentDocNames: readonly ImplicitArgumentDocEntry[]
) {
    appendExplicitParameterDocLines({
        lines,
        node,
        options,
        documentedParamNames,
        orderedParamMetadata,
        paramMetadataByCanonical,
        implicitDocEntryByIndex
    });
    appendImplicitArgumentDocLines({
        lines,
        node,
        documentedParamNames,
        orderedParamMetadata,
        implicitArgumentDocNames
    });
}
