import { Core } from "@gmloop/core";
import { Command } from "commander";
import type { Element } from "linkedom/types/interface/element.js";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { isMainModule, runAsMainModule } from "../cli-core/main-module-runner.js";
import { assertSupportedNodeVersion } from "../cli-core/node-version.js";
import {
    getDirectElementChildren,
    parseManualDocument,
    replaceBreakElementsWithNewlines
} from "../modules/manual/html.js";
import { getManualRootMetadataPath, readManualText, resolveManualSourceCommitHash } from "../modules/manual/source.js";
import { type ManualWorkflowOptions, prepareManualWorkflow } from "../modules/manual/workflow.js";
import { writeJsonArtifact } from "../shared/fs-artifacts.js";
import { createVerboseDurationLogger, timeSync } from "../shared/timing/verbose-timing.js";
import { resolveFromRepoRoot } from "../shared/workspace-paths.js";

const {
    compactArray,
    escapeRegExp,
    getNonEmptyTrimmedString,
    isNonEmptyArray,
    isNonEmptyString,
    toNormalizedLowerCaseSet
} = Core;

const DEFAULT_OUTPUT_PATH = resolveFromRepoRoot("resources", "feather-metadata.json");

const FEATHER_PAGES = {
    diagnostics: "Manual/contents/The_Asset_Editors/Code_Editor_Properties/Feather_Messages.htm",
    directives: "Manual/contents/The_Asset_Editors/Code_Editor_Properties/Feather_Directives.htm",
    naming: "Manual/contents/Setting_Up_And_Version_Information/IDE_Preferences/Feather_Settings.htm",
    typeSystem: "Manual/contents/The_Asset_Editors/Code_Editor_Properties/Feather_Data_Types.htm"
};

interface FeatherMetadataCommandOptions {
    output?: string;
    manualRoot?: string;
    manualPackage?: string;
    quiet?: boolean;
}

interface NormalizedFeatherMetadataOptions {
    outputPath: string;
    manualRoot: string | null;
    manualPackage: string | null;
    quiet: boolean;
}

interface FeatherMetadataCommandContext {
    command?: CommanderCommandLike;
    workflow?: ManualWorkflowOptions["workflow"];
}

/**
 * Create the CLI command for generating Feather metadata.
 *
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {import("commander").Command}
 */
export function createFeatherMetadataCommand() {
    const command = applyStandardCommandOptions(
        new Command()
            .name("generate-feather-metadata")
            .usage("[options]")
            .description("Generate feather-metadata.json from the GameMaker manual.")
    );

    command
        .option("--output <path>", "Path to write feather-metadata.json.", DEFAULT_OUTPUT_PATH)
        .option("--manual-root <path>", "Override the manual asset root (defaults to vendor/GameMaker-Manual).")
        .option(
            "--manual-package <name>",
            "Manual pnpm package name used when neither --manual-root nor the vendor submodule is available."
        )
        .option("--quiet", "Suppress progress output (useful in CI).");

    return command;
}

/**
 * Resolve normalized CLI options for the Feather metadata command.
 *
 * @param {CommanderCommandLike | undefined} command
 * @returns {ManualCommandOptions}
 */
function resolveFeatherMetadataOptions(command?: CommanderCommandLike): NormalizedFeatherMetadataOptions {
    const options: FeatherMetadataCommandOptions = command?.opts?.() ?? {};

    return {
        outputPath: options.output ?? DEFAULT_OUTPUT_PATH,
        manualRoot: options.manualRoot ?? null,
        manualPackage: options.manualPackage ?? null,
        quiet: Boolean(options.quiet)
    };
}

function createVerboseState({ quiet }) {
    return quiet ? { parsing: false } : { parsing: true };
}

function normalizeMultilineText(text) {
    if (!isNonEmptyString(text)) {
        return null;
    }

    const normalizedLines = [];
    let pendingBlank = false;

    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();

        if (line.length === 0) {
            if (normalizedLines.length > 0) {
                pendingBlank = true;
            }
            continue;
        }

        if (pendingBlank) {
            normalizedLines.push("");
            pendingBlank = false;
        }

        normalizedLines.push(line);
    }

    return normalizedLines.join("\n").trim();
}

function sanitizeManualString(value) {
    if (typeof value !== "string") {
        return null;
    }

    return normalizeMultilineText(value);
}

function normalizeMultilineTextCollection(values, { preserveEmptyEntries = false, emptyEntryValue = null } = {}) {
    if (!Array.isArray(values)) {
        return [];
    }

    const normalized = [];

    for (const value of values) {
        const text = normalizeMultilineText(value);

        if (text) {
            normalized.push(text);
        } else if (preserveEmptyEntries) {
            normalized.push(emptyEntryValue);
        }
    }

    return normalized;
}

function getNormalizedTextContent(element, { trim = false } = {}) {
    if (!element) {
        return trim ? null : "";
    }

    const { textContent } = element;
    if (!isNonEmptyString(textContent)) {
        return trim ? null : "";
    }

    const normalized = textContent.replaceAll("\u00A0", " ");
    if (!trim) {
        return normalized;
    }

    return getNonEmptyTrimmedString(normalized);
}

function isElement(node) {
    return node?.nodeType === node?.ownerDocument?.ELEMENT_NODE;
}

function getTagName(element) {
    return element?.tagName?.toLowerCase() ?? "";
}

function splitCellLines(element: Element | null | undefined) {
    if (!element) {
        return [];
    }

    const clone = element.cloneNode(true) as Element;
    replaceBreakElementsWithNewlines(clone);

    const lines =
        clone.textContent
            ?.replaceAll("\u00A0", " ")
            .split("\n")
            .map((line) => line.replaceAll(/\s+/g, " ").trim()) ?? [];

    return compactArray(lines);
}

function createTableExtractionState(): ManualTable {
    return { headers: [], rows: [] };
}

function getRowCells(row) {
    return getDirectElementChildren(row, "th, td");
}

function extractCellValue(cell) {
    const lines = splitCellLines(cell);
    if (lines.length === 0) {
        return null;
    }

    return lines.join("\n");
}

function buildRowValues(cellElements) {
    return cellElements.map(extractCellValue);
}

function rowHasContent(values) {
    return values.some((value) => getNonEmptyTrimmedString(value));
}

function hasHeaderCells(cellElements) {
    return cellElements.some((cell) => getTagName(cell) === "th");
}

function isHeaderRow(rowIndex, cellElements) {
    return rowIndex === 0 && hasHeaderCells(cellElements);
}

function appendHeaderValues(headers, values) {
    headers.push(...normalizeMultilineTextCollection(values));
}

function appendBodyRow(rows, values) {
    rows.push(
        normalizeMultilineTextCollection(values, {
            preserveEmptyEntries: true
        })
    );
}

function processTableRow(state, row, rowIndex) {
    const cellElements = getRowCells(row);
    const values = buildRowValues(cellElements);

    if (!rowHasContent(values)) {
        return;
    }

    if (isHeaderRow(rowIndex, cellElements)) {
        appendHeaderValues(state.headers, values);
        return;
    }

    appendBodyRow(state.rows, values);
}

function extractTable(table) {
    const tableState = createTableExtractionState();
    const rowElements = Array.from(table.querySelectorAll("tr"));

    rowElements.forEach((row, rowIndex) => {
        processTableRow(tableState, row, rowIndex);
    });

    return tableState;
}

interface ManualTable {
    headers: ReadonlyArray<string>;
    rows: ReadonlyArray<ReadonlyArray<string | null>>;
}

interface ManualBlock {
    type: string;
    text: string;
    level?: number;
    items?: ReadonlyArray<string>;
    table?: ManualTable;
}

function createClassListChecker(element: Element | null | undefined) {
    const classList = element?.classList;

    if (!classList || typeof classList.contains !== "function") {
        return () => false;
    }

    return (className) => classList.contains(className);
}

function shouldSkipManualBlock(hasClass) {
    return hasClass("footer") || hasClass("seealso");
}

function resolveBlockType(tagName, hasClass) {
    if (tagName === "p") {
        if (hasClass("code")) {
            return "code";
        }

        if (hasClass("note") || hasClass("warning")) {
            return "note";
        }

        return "paragraph";
    }

    if (tagName === "h4" || tagName === "h5") {
        return "heading";
    }

    if (tagName === "ul" || tagName === "ol") {
        return "list";
    }

    if (tagName === "table") {
        return "table";
    }

    if (tagName === "div" && hasClass("codeblock")) {
        return "code";
    }

    return "html";
}

function getHeadingLevel(tagName) {
    return tagName === "h4" || tagName === "h5" ? Number(tagName.slice(1)) : null;
}

function extractListItems(element) {
    const items = getDirectElementChildren(element, "li").map((item) =>
        extractText(item, { preserveLineBreaks: false })
    );

    return compactArray(items);
}

function createBlock(node) {
    if (!isElement(node)) {
        return null;
    }

    const element = node;
    const hasClass = createClassListChecker(element);

    if (shouldSkipManualBlock(hasClass)) {
        return null;
    }

    const tagName = getTagName(element);
    const type = resolveBlockType(tagName, hasClass);
    const preserveLineBreaks = type === "code" || type === "list";
    const text = extractText(element, { preserveLineBreaks });

    if (!text && type !== "list") {
        return null;
    }

    const block: ManualBlock = { type, text };
    const headingLevel = getHeadingLevel(tagName);

    if (headingLevel !== null) {
        block.level = headingLevel;
    }

    if (type === "list") {
        const items = extractListItems(element);

        if (items.length === 0 && !text) {
            return null;
        }

        block.items = items;
    }

    if (type === "table") {
        block.table = extractTable(element);
    }

    return block;
}

function extractText(element, { preserveLineBreaks = false } = {}) {
    if (!element) {
        return "";
    }

    const clone = element.cloneNode(true) as Element;
    replaceBreakElementsWithNewlines(clone);

    const text = getNormalizedTextContent(clone);
    if (preserveLineBreaks) {
        return text
            .split("\n")
            .map((line) => line.trimEnd())
            .join("\n")
            .trim();
    }

    return text.replaceAll(/\s+/g, " ").trim();
}

function extractSanitizedText(element, { preserveLineBreaks = false } = {}) {
    const text = extractText(element, { preserveLineBreaks });
    return sanitizeManualString(text) ?? null;
}

function collectBlocksAfter(element, { stopTags = [] } = {}) {
    const stopSet = toNormalizedLowerCaseSet(stopTags);
    const blocks = [];
    let node = element?.nextSibling;
    while (node) {
        if (isElement(node)) {
            const tagName = getTagName(node);
            if (stopSet.has(tagName)) {
                break;
            }
            if (tagName === "div" && node.classList?.contains("footer")) {
                break;
            }
            const block = createBlock(node);
            if (block) {
                blocks.push(block);
            }
        }
        node = node.nextSibling;
    }
    return blocks;
}

function normalizeTextBlock(block) {
    if (!block) {
        return null;
    }
    if (block.type === "list" && isNonEmptyArray(block.items)) {
        return getNonEmptyTrimmedString(block.items.join("\n"));
    }
    return getNonEmptyTrimmedString(block.text);
}

function pushNormalizedText(target, value) {
    const normalized = normalizeMultilineText(value);
    if (normalized) {
        target.push(normalized);
    }
}

function normalizeListItems(items) {
    return normalizeMultilineTextCollection(items);
}

function collectNamingRuleSectionOptions(listItem) {
    const nestedList = listItem.querySelector("ul");
    if (!nestedList) {
        return [];
    }

    const options = getDirectElementChildren(nestedList, "li").map((option) =>
        normalizeMultilineText(extractText(option, { preserveLineBreaks: false }))
    );

    return compactArray(options);
}

function createNamingRuleSection(listItem) {
    const strongChildren = getDirectElementChildren(listItem, "strong");
    const title = getNormalizedTextContent(strongChildren[0], { trim: true });
    const description = extractText(listItem, { preserveLineBreaks: true });
    let normalizedDescription = normalizeMultilineText(description);

    if (title && normalizedDescription) {
        const prefixPattern = new RegExp(String.raw`^${escapeRegExp(title)}\s*:?\s*`, "i");
        normalizedDescription = normalizedDescription.replace(prefixPattern, "").trim();
    }

    return {
        title,
        description: normalizedDescription,
        options: collectNamingRuleSectionOptions(listItem)
    };
}

function updateNamingListMetadataFromStrongElement(strongEl, metadata) {
    const strongText = getNormalizedTextContent(strongEl, { trim: true });
    if (!strongText) {
        return;
    }

    const listItem = strongEl.closest("li");
    if (!listItem) {
        return;
    }

    if (strongText === "Naming Style") {
        const styles = Array.from(listItem.querySelectorAll("ul li")).map((styleEl) =>
            extractSanitizedText(styleEl, {
                preserveLineBreaks: false
            })
        );
        metadata.namingStyleOptions = compactArray(styles);
    } else if (strongText === "Identifier Blocklist") {
        metadata.identifierBlocklist = extractSanitizedText(listItem, {
            preserveLineBreaks: true
        });
    } else if (strongText.endsWith("Naming Rule")) {
        metadata.identifierRuleSummary = extractSanitizedText(listItem, {
            preserveLineBreaks: true
        });
    } else if (strongText === "Prefix") {
        metadata.supportsPrefix = true;
    } else if (strongText === "Suffix") {
        metadata.supportsSuffix = true;
    } else if (strongText.toLowerCase().includes("preserve")) {
        metadata.supportsPreserveUnderscores = true;
    }
}

function collectNamingListMetadata(mainList) {
    const metadata = {
        namingStyleOptions: [],
        identifierBlocklist: null,
        identifierRuleSummary: null,
        supportsPrefix: false,
        supportsSuffix: false,
        supportsPreserveUnderscores: false,
        ruleSections: []
    };

    if (!mainList) {
        return metadata;
    }

    for (const strongEl of mainList.querySelectorAll("li > strong")) {
        updateNamingListMetadataFromStrongElement(strongEl, metadata);
    }

    metadata.ruleSections = getDirectElementChildren(mainList, "li").map((item) => createNamingRuleSection(item));

    return metadata;
}

const BLOCK_NORMALIZERS = {
    code: (content, block) => {
        if (block.text) {
            content.codeExamples.push(block.text);
        }
    },
    note: (content, block) => {
        pushNormalizedText(content.notes, block.text);
    },
    list: (content, block) => {
        const items = normalizeListItems(block.items);
        if (items.length > 0) {
            content.lists.push(items);
        }
    },
    table: (content, block) => {
        if (block.table) {
            content.tables.push(block.table);
        }
    },
    heading: (content, block) => {
        pushNormalizedText(content.headings, block.text);
    },
    default: (content, block) => {
        pushNormalizedText(content.paragraphs, block.text);
    }
};

function normalizeContent(blocks) {
    const content = {
        paragraphs: [],
        notes: [],
        codeExamples: [],
        lists: [],
        headings: [],
        tables: []
    };

    for (const block of blocks) {
        if (!block) {
            continue;
        }

        const normalizeBlock = BLOCK_NORMALIZERS[block.type] ?? BLOCK_NORMALIZERS.default;
        normalizeBlock(content, block);
    }

    return content;
}

function joinSections(parts) {
    if (!isNonEmptyArray(parts)) {
        return null;
    }

    const normalizedParts = compactArray(parts.map((part) => getNonEmptyTrimmedString(part)));

    if (!isNonEmptyArray(normalizedParts)) {
        return null;
    }

    return normalizedParts.join("\n\n");
}

function slugify(text) {
    return text
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-+|-+$/g, "")
        .slice(0, 64);
}

// Split the collected manual blocks into descriptive and trailing sections.
function splitDiagnosticBlocks(blocks) {
    const exampleHeadingIndex = blocks.findIndex(
        (block) => block.type === "heading" && /example/i.test(block.text ?? "")
    );
    const firstCodeIndex = blocks.findIndex((block) => block.type === "code");

    let trailingStart = blocks.length;
    if (exampleHeadingIndex !== -1) {
        trailingStart = exampleHeadingIndex + 1;
    } else if (firstCodeIndex !== -1) {
        trailingStart = firstCodeIndex;
    }

    return {
        descriptionBlocks: blocks.slice(0, trailingStart),
        trailingBlocks: blocks.slice(trailingStart)
    };
}

// Extract paragraph-style content from the initial diagnostic blocks.
function collectDiagnosticDescriptionParts(blocks) {
    const descriptionParts = [];
    for (const block of blocks) {
        if (block.type === "heading") {
            continue;
        }
        const text = normalizeTextBlock(block);
        if (text) {
            descriptionParts.push(text);
        }
    }
    return descriptionParts;
}

// Analyse trailing blocks to determine examples and correction guidance.
function collectDiagnosticTrailingContent(blocks) {
    const additionalDescriptionParts = [];
    const correctionParts = [];
    const goodExampleParts = [];
    let badExample = null;

    for (const block of blocks) {
        if (!block || block.type === "heading") {
            continue;
        }

        const text = normalizeTextBlock(block);
        if (!text) {
            continue;
        }

        if (block.type !== "code") {
            const targetParts = badExample ? correctionParts : additionalDescriptionParts;
            targetParts.push(text);
            continue;
        }

        if (!badExample) {
            badExample = text;
            continue;
        }

        goodExampleParts.push(text);
    }

    const goodExample = joinSections(goodExampleParts);

    return {
        additionalDescriptionParts,
        correctionParts,
        badExample,
        goodExample
    };
}

// Convert the raw manual blocks into structured diagnostic metadata.
function summariseDiagnosticBlocks(blocks) {
    const { descriptionBlocks, trailingBlocks } = splitDiagnosticBlocks(blocks);
    const descriptionParts = collectDiagnosticDescriptionParts(descriptionBlocks);
    const { additionalDescriptionParts, correctionParts, badExample, goodExample } =
        collectDiagnosticTrailingContent(trailingBlocks);

    if (additionalDescriptionParts.length > 0) {
        descriptionParts.push(...additionalDescriptionParts);
    }

    return {
        descriptionParts,
        correctionParts,
        badExample,
        goodExample
    };
}

/**
 * Build structured diagnostic metadata from a manual heading element.
 *
 * @param {Element | null | undefined} element
 * @returns {{
 *     id: string;
 *     title: string;
 *     description: string | null;
 *     badExample: string | null;
 *     goodExample: string | null;
 *     correction: string | null;
 * } | null}
 */
function createDiagnosticMetadataFromHeading(element) {
    const headingText = getNormalizedTextContent(element, { trim: true });
    if (!headingText) {
        return null;
    }

    const match = headingText.match(/^(GM\d{3,})\s*-\s*(.+)$/);
    if (!match) {
        return null;
    }

    const [, id, title] = match;
    const blocks = collectBlocksAfter(element, {
        stopTags: ["h3", "h2"]
    });

    const { descriptionParts, correctionParts, badExample, goodExample } = summariseDiagnosticBlocks(blocks);

    return {
        id,
        title: getNonEmptyTrimmedString(title) ?? (typeof title === "string" ? title.trim() : ""),
        description: joinSections(descriptionParts),
        badExample,
        goodExample,
        correction: joinSections(correctionParts)
    };
}

/**
 * Collect diagnostic metadata entries from a list of heading nodes.
 *
 * @param {Iterable<Element>} headingElements
 */
function collectDiagnosticsFromHeadings(headingElements) {
    const diagnostics = [];
    for (const heading of headingElements ?? []) {
        const metadata = createDiagnosticMetadataFromHeading(heading);
        if (metadata) {
            diagnostics.push(metadata);
        }
    }
    return diagnostics;
}

function parseDiagnostics(html) {
    const document = parseManualDocument(html);
    return collectDiagnosticsFromHeadings(document.querySelectorAll("h3"));
}

function parseNamingRules(html) {
    const document = parseManualDocument(html);
    const heading = document.querySelector("h2#s4");
    if (!heading) {
        return {
            overview: null,
            notes: [],
            namingStyleOptions: [],
            supportsPrefix: false,
            supportsSuffix: false,
            supportsPreserveUnderscores: false,
            ruleSections: []
        };
    }

    const blocks = collectBlocksAfter(heading, { stopTags: ["h2"] });
    const content = normalizeContent(blocks);
    const overview = joinSections(content.paragraphs);
    const notes = content.notes;
    const requiresMessage =
        (overview && overview.includes("GM2017")) || notes.find((note) => note.includes("GM2017")) ? "GM2017" : null;

    let sibling = heading.nextElementSibling;
    let mainList = null;
    while (sibling) {
        if (getTagName(sibling) === "ul") {
            mainList = sibling;
            break;
        }
        sibling = sibling.nextElementSibling;
    }

    const {
        namingStyleOptions,
        identifierBlocklist,
        identifierRuleSummary,
        supportsPrefix,
        supportsSuffix,
        supportsPreserveUnderscores,
        ruleSections
    } = collectNamingListMetadata(mainList);

    return {
        overview,
        notes,
        namingStyleOptions,
        requiresMessage,
        supportsPrefix,
        supportsSuffix,
        supportsPreserveUnderscores,
        identifierBlocklist: identifierBlocklist ?? null,
        identifierRuleSummary: identifierRuleSummary ?? null,
        ruleSections
    };
}

function parseDirectiveSections(html) {
    const document = parseManualDocument(html);
    const sections = [];

    for (const element of document.querySelectorAll("h2")) {
        const title = getNormalizedTextContent(element, { trim: true });
        if (!title) {
            continue;
        }

        const blocks = collectBlocksAfter(element, { stopTags: ["h2"] });
        const id = element.getAttribute("id") || slugify(title);
        const content = normalizeContent(blocks);
        sections.push({
            id,
            title,
            description: joinSections(content.paragraphs) || null,
            notes: content.notes,
            codeExamples: content.codeExamples,
            lists: content.lists,
            subheadings: content.headings,
            tables: content.tables
        });
    }

    return sections;
}

function parseBaseTypeTable(table: Element) {
    const baseTypes = [];
    const rowElements = Array.from(table.querySelectorAll("tbody > tr, thead + tr"));

    rowElements.forEach((row, index) => {
        if (index === 0) {
            return;
        }

        const cells = getDirectElementChildren(row, "th, td");
        if (cells.length < 3) {
            return;
        }

        const [nameCell, exampleCell, descriptionCell] = cells;
        const name = extractText(nameCell, { preserveLineBreaks: false });
        const specifierExamples = splitCellLines(exampleCell);
        const description = extractText(descriptionCell, {
            preserveLineBreaks: false
        });
        baseTypes.push({ name, specifierExamples, description });
    });

    return baseTypes;
}

function parseTypeValidationTable(table: Element | null) {
    if (!table) {
        return null;
    }

    const headerRow = table.querySelector("tr");
    if (!headerRow) {
        return null;
    }

    const headerCells = getDirectElementChildren(headerRow, "th, td");
    const columns = compactArray(
        headerCells.slice(1).map((cell) => getNonEmptyTrimmedString(extractText(cell, { preserveLineBreaks: false })))
    );

    const rows = [];
    const dataRows = Array.from(table.querySelectorAll("tr")).slice(1);
    for (const row of dataRows) {
        const cells = getDirectElementChildren(row, "th, td");
        if (cells.length === 0) {
            continue;
        }
        const from = getNonEmptyTrimmedString(extractText(cells[0], { preserveLineBreaks: false }));
        if (!from) {
            continue;
        }
        const results = {};
        columns.forEach((column, columnIndex) => {
            const cell = cells[columnIndex + 1];
            const outcome = cell ? getNonEmptyTrimmedString(extractText(cell, { preserveLineBreaks: false })) : null;
            const rawStyle = cell?.getAttribute?.("style");
            const style = getNonEmptyTrimmedString(rawStyle?.replaceAll(/\s+/g, " "));
            results[column] = {
                outcome,
                style
            };
        });
        rows.push({ from, results });
    }

    return { columns, rows };
}

function parseTypeSystem(html) {
    const document = parseManualDocument(html);
    const introBlocks = [];
    const articleBody = document.querySelector("h1");
    if (articleBody) {
        let node = articleBody.nextSibling;
        while (node) {
            if (isElement(node) && getTagName(node) === "table") {
                break;
            }
            if (isElement(node)) {
                const block = createBlock(node);
                if (block) {
                    introBlocks.push(block);
                }
            }
            node = node.nextSibling;
        }
    }
    const introContent = normalizeContent(introBlocks);

    const tables = Array.from(document.querySelectorAll("table"));
    const baseTypeTable = tables[0] ?? null;
    const baseTypes = baseTypeTable ? parseBaseTypeTable(baseTypeTable) : [];

    const noteBlocks = compactArray(
        Array.from(document.querySelectorAll("p.note")).map((element) => createBlock(element))
    );
    const notes = normalizeMultilineTextCollection(noteBlocks.map((block) => block.text));

    const specifierSections = [];
    for (const element of document.querySelectorAll("h3")) {
        const title = getNormalizedTextContent(element, { trim: true });
        if (!title) {
            continue;
        }
        const blocks = collectBlocksAfter(element, {
            stopTags: ["h3", "h2"]
        });
        const content = normalizeContent(blocks);
        specifierSections.push({
            id: element.getAttribute("id") || slugify(title),
            title,
            description: joinSections(content.paragraphs) || undefined,
            notes: content.notes,
            codeExamples: content.codeExamples,
            lists: content.lists
        });
    }

    const typeValidationHeading = Array.from(document.querySelectorAll("h2")).find((element) =>
        element.textContent?.includes("Type Validation")
    );

    let typeValidation = null;
    let typeValidationBlocks = [];
    if (typeValidationHeading) {
        typeValidationBlocks = collectBlocksAfter(typeValidationHeading, {
            stopTags: ["table", "h2"]
        });
        let sibling = typeValidationHeading.nextElementSibling;
        let validationTable = null;
        while (sibling) {
            if (getTagName(sibling) === "table") {
                validationTable = sibling;
                break;
            }
            if (getTagName(sibling) === "h2") {
                break;
            }
            sibling = sibling.nextElementSibling;
        }
        typeValidation = validationTable ? parseTypeValidationTable(validationTable) : null;
    }

    const typeValidationContent = normalizeContent(typeValidationBlocks);

    return {
        overview: joinSections(introContent.paragraphs) || undefined,
        overviewNotes: introContent.notes,
        baseTypes: baseTypes.map((type) => ({
            name: type.name,
            specifierExamples: normalizeMultilineTextCollection(type.specifierExamples),
            description: normalizeMultilineText(type.description)
        })),
        notes,
        specifierSections,
        typeValidation: typeValidation
            ? {
                  description: joinSections(typeValidationContent.paragraphs) || undefined,
                  notes: typeValidationContent.notes,
                  codeExamples: typeValidationContent.codeExamples,
                  lists: typeValidationContent.lists,
                  table: typeValidation
              }
            : undefined
    };
}

function createFeatherManualMetadataPayload({ manualSource, manualCommitHash, sections }) {
    return {
        meta: {
            manualRoot: getManualRootMetadataPath(manualSource),
            packageName: manualSource.packageName,
            packageVersion: manualSource.packageJson?.version ?? null,
            manualCommitHash,
            manualPaths: { ...FEATHER_PAGES }
        },
        ...sections
    };
}

async function readFeatherManualPayloads({ manualSource, onRead }) {
    const payloads = Object.create(null);

    await Core.runSequentially(Object.entries(FEATHER_PAGES), async ([key, manualPath]) => {
        if (typeof onRead === "function") {
            onRead(manualPath);
        }

        payloads[key] = await readManualText(manualSource.root, manualPath);
    });

    return payloads;
}

/**
 * Parse the downloaded manual payloads into normalized section metadata.
 * Keeping the transformation logic isolated lets the command orchestrator
 * delegate high-level steps without juggling raw payload bookkeeping.
 */

function parseFeatherManualPayloads(htmlPayloads, { verbose }) {
    if (verbose.parsing) {
        console.log("Parsing manual sections…");
    }

    return {
        diagnostics: timeSync("Diagnostics", () => parseDiagnostics(htmlPayloads.diagnostics), { verbose }),
        directives: timeSync("Directives", () => parseDirectiveSections(htmlPayloads.directives), { verbose }),
        namingRules: timeSync("Naming rules", () => parseNamingRules(htmlPayloads.naming), { verbose }),
        typeSystem: timeSync("Type system", () => parseTypeSystem(htmlPayloads.typeSystem), { verbose })
    };
}

/**
 * Download and parse the manual pages required to build the Feather metadata
 * artefact. Returning the final payload keeps the command runner free from
 * low-level payload maps and section assembly concerns.
 */
async function buildFeatherMetadataPayload({ manualSource, manualCommitHash, verbose, onRead }) {
    const htmlPayloads = await readFeatherManualPayloads({
        manualSource,
        onRead
    });

    const sections = parseFeatherManualPayloads(htmlPayloads, { verbose });

    return createFeatherManualMetadataPayload({
        manualSource,
        manualCommitHash,
        sections
    });
}

/**
 * Execute the Feather metadata generation workflow.
 *
 * @param {{
 *   command?: import("commander").Command,
 *   workflow?: {
 *       allowPaths?: Iterable<unknown>,
 *       denyPaths?: Iterable<unknown>,
 *       allowsPath?: (candidate: string) => boolean,
 *       allowsDirectory?: (candidate: string) => boolean
 *   }
 * }} [context]
 * @returns {Promise<number>}
 */
export async function runGenerateFeatherMetadata({ command, workflow }: FeatherMetadataCommandContext = {}) {
    assertSupportedNodeVersion();

    const { outputPath, manualRoot, manualPackage, quiet } = resolveFeatherMetadataOptions(command);
    const verbose = createVerboseState({ quiet });
    const { workflowPathFilter, manualSource } = await prepareManualWorkflow({
        workflow,
        outputPath,
        manualRoot,
        manualPackage,
        quiet
    });
    const manualCommitHash = resolveManualSourceCommitHash(manualSource);

    const logCompletion = createVerboseDurationLogger({ verbose });
    const payload = await buildFeatherMetadataPayload({
        manualSource,
        manualCommitHash,
        verbose,
        onRead: quiet
            ? undefined
            : (manualPath) => {
                  console.log(`Reading ${manualPath}`);
              }
    });

    await writeJsonArtifact({
        outputPath,
        payload,
        pathFilter: workflowPathFilter,
        onAfterWrite: () => {
            if (!quiet) {
                console.log(`Wrote Feather metadata to ${outputPath}`);
            }
        }
    });

    logCompletion();
    return 0;
}

if (isMainModule(import.meta.url)) {
    runAsMainModule({
        programName: "generate-feather-metadata",
        createCommand: createFeatherMetadataCommand,
        run: ({ command }) => runGenerateFeatherMetadata({ command }),
        errorPrefix: "Failed to generate Feather metadata."
    });
}
