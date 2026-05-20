import { Core } from "@gmloop/core";

import { formatPathForDisplay } from "../workflow/display-path.js";

const { compactArray } = Core;

/**
 * Captures a sample ignored file path and the ignore source used to skip it.
 */
export type IgnoredFileSample = {
    filePath: string;
    sourceDescription: string;
};

/**
 * Summary of skipped files grouped by skip category.
 */
export type SkippedFileSummary = {
    ignored: number;
    ignoredSamples: Array<IgnoredFileSample>;
    unsupportedExtension: number;
    unsupportedExtensionSamples: Array<string>;
    symbolicLink: number;
};

/**
 * Summary of ignored directories encountered while walking a target tree.
 */
export type SkippedDirectorySummary = {
    ignored: number;
    ignoredSamples: Array<string>;
};

/**
 * Build the CLI message shown when no formattable files are matched.
 */
export function buildNoMatchingFilesMessage({
    targetPath,
    targetIsDirectory,
    targetPathProvided,
    extensions,
    ignoredFilesSkipped,
    gmlExtension,
    cliExample,
    workspaceExample
}: {
    targetPath: string;
    targetIsDirectory: boolean;
    targetPathProvided: boolean | undefined;
    extensions: ReadonlyArray<string>;
    ignoredFilesSkipped: boolean;
    gmlExtension: string;
    cliExample: string;
    workspaceExample: string;
}): string {
    const formattedExtensions = formatExtensionListForDisplay(extensions);
    const formattedTarget = formatPathForDisplay(targetPath);
    const locationDescription = targetIsDirectory
        ? describeDirectoryWithoutMatches({
              formattedTargetPath: formattedTarget,
              targetPathProvided
          })
        : formattedTarget;
    const nothingToFormatMessage = "Nothing to format.";
    const exampleGuidance = `For example: ${cliExample} or ${workspaceExample}.`;
    const guidance = targetIsDirectory
        ? [
              `Provide a directory or file containing ${gmlExtension} sources.`,
              exampleGuidance,
              "Update your .prettierignore files if this is unexpected."
          ].join(" ")
        : [
              `Pass a ${gmlExtension} file or a directory containing ${gmlExtension} files, or adjust your .prettierignore files if this is unexpected.`,
              exampleGuidance
          ].join(" ");
    const ignoredMessageSuffix = "Adjust your .prettierignore files or refine the target path if this is unexpected.";

    if (targetIsDirectory) {
        if (ignoredFilesSkipped) {
            return [
                `All files matching ${formattedExtensions} were skipped ${locationDescription} by ignore rules.`,
                nothingToFormatMessage,
                ignoredMessageSuffix
            ].join(" ");
        } else {
            return [
                `No files matching ${formattedExtensions} were found ${locationDescription}.`,
                nothingToFormatMessage,
                guidance
            ].join(" ");
        }
    } else {
        if (ignoredFilesSkipped) {
            return [
                `${locationDescription} was skipped by ignore rules and not formatted.`,
                nothingToFormatMessage,
                ignoredMessageSuffix
            ].join(" ");
        } else {
            return [
                `${locationDescription} does not match the supported extension ${formattedExtensions}.`,
                nothingToFormatMessage,
                guidance
            ].join(" ");
        }
    }
}

/**
 * Build the write-mode completion message.
 */
export function buildWriteModeSummaryMessage({
    formattedFileCount,
    targetPath,
    targetIsDirectory,
    targetPathProvided,
    cliExample,
    workspaceExample
}: {
    formattedFileCount: number;
    targetPath?: string;
    targetIsDirectory?: boolean;
    targetPathProvided?: boolean;
    cliExample: string;
    workspaceExample: string;
}): string {
    if (formattedFileCount === 0) {
        return "All matched files are already formatted.";
    }

    const label = formattedFileCount === 1 ? "file" : "files";
    let message = `Formatted ${formattedFileCount} ${label}.`;
    if (targetIsDirectory) {
        const formattedTarget = formatPathForDisplay(targetPath || ".");
        const locationPhrase = formatLocationPhrase({
            formattedTargetPath: formattedTarget,
            targetPathProvided
        });
        message = `Formatted ${formattedFileCount} ${label} found in ${locationPhrase}.`;
        if (!targetPathProvided) {
            const exampleGuidance = `For example: ${cliExample} or ${workspaceExample}.`;
            message = `${message} ${exampleGuidance}`;
        }
    }

    return message;
}

/**
 * Build detail labels for skipped-file summary output.
 */
export function buildSkippedFileDetailEntries({
    ignored,
    ignoredSamples,
    unsupportedExtension,
    unsupportedExtensionSamples,
    symbolicLink
}: SkippedFileSummary): Array<string> {
    const detailEntries = [];

    const ignoredDetail = formatIgnoredDetail({
        ignored,
        ignoredSamples
    });
    if (ignoredDetail) {
        detailEntries.push(ignoredDetail);
    }

    const unsupportedExtensionDetail = formatUnsupportedExtensionDetail({
        unsupportedExtension,
        unsupportedExtensionSamples
    });
    if (unsupportedExtensionDetail) {
        detailEntries.push(unsupportedExtensionDetail);
    }

    const symbolicLinkDetail = formatSymbolicLinkDetail(symbolicLink);
    if (symbolicLinkDetail) {
        detailEntries.push(symbolicLinkDetail);
    }

    return detailEntries;
}

/**
 * Build the skipped-directory summary message when directories were ignored.
 */
export function buildSkippedDirectorySummaryMessage({
    ignored,
    ignoredSamples
}: SkippedDirectorySummary): null | string {
    if (ignored === 0) {
        return null;
    }

    const label = ignored === 1 ? "directory" : "directories";
    const formattedSamples = ignoredSamples.map((directory) => formatPathForDisplay(directory));

    if (formattedSamples.length === 0) {
        return `Skipped ${ignored} ${label} ignored by .prettierignore.`;
    }

    const exampleSuffix = formatExampleSuffix(formattedSamples, ignored);
    return `Skipped ${ignored} ${label} ignored by .prettierignore${exampleSuffix}.`;
}

function formatExtensionListForDisplay(extensions: ReadonlyArray<string>): string {
    return extensions.map((extension) => `"${extension}"`).join(", ");
}

function describeDirectoryWithoutMatches({
    formattedTargetPath,
    targetPathProvided
}: {
    formattedTargetPath: string;
    targetPathProvided: boolean | undefined;
}): string {
    if (!targetPathProvided) {
        return "in the current working directory (.)";
    }

    if (formattedTargetPath === ".") {
        return "in the current directory";
    }

    return `in ${formattedTargetPath}`;
}

function formatLocationPhrase({
    formattedTargetPath,
    targetPathProvided
}: {
    formattedTargetPath: string;
    targetPathProvided: boolean | undefined;
}): string {
    if (!targetPathProvided) {
        return "the current working directory (.)";
    }

    if (formattedTargetPath === ".") {
        return "the current directory";
    }

    return formattedTargetPath;
}

function formatExampleSuffix(formattedSamples: ReadonlyArray<string>, totalCount: number): string {
    if (formattedSamples.length === 0) {
        return "";
    }

    const sampleList = formattedSamples.join(", ");
    const ellipsis = totalCount > formattedSamples.length ? ", ..." : "";
    return ` (e.g., ${sampleList}${ellipsis})`;
}

function formatIgnoredFileSample(sample: IgnoredFileSample): null | string {
    const { filePath, sourceDescription } = sample;
    if (typeof filePath !== "string" || filePath.length === 0) {
        return null;
    }

    const formattedPath = formatPathForDisplay(filePath);

    if (!sourceDescription || sourceDescription === "ignored") {
        return formattedPath;
    }

    return `${formattedPath} (${sourceDescription})`;
}

function formatIgnoredDetail({
    ignored,
    ignoredSamples
}: {
    ignored: number;
    ignoredSamples: ReadonlyArray<IgnoredFileSample>;
}): null | string {
    if (ignored <= 0) {
        return null;
    }

    const formattedSamples = compactArray((ignoredSamples ?? []).map((sample) => formatIgnoredFileSample(sample)));
    const suffix = formatExampleSuffix(formattedSamples, ignored);

    return `ignored by .prettierignore (${ignored})${suffix}`;
}

function formatUnsupportedExtensionSample(sample: string): null | string {
    if (sample.length === 0) {
        return null;
    }

    return formatPathForDisplay(sample);
}

function formatUnsupportedExtensionDetail({
    unsupportedExtension,
    unsupportedExtensionSamples
}: {
    unsupportedExtension: number;
    unsupportedExtensionSamples: ReadonlyArray<string>;
}): null | string {
    if (unsupportedExtension <= 0) {
        return null;
    }

    const formattedSamples = compactArray(
        (unsupportedExtensionSamples ?? []).map((sample) => formatUnsupportedExtensionSample(sample))
    );
    const suffix = formatExampleSuffix(formattedSamples, unsupportedExtension);

    return `unsupported extensions (${unsupportedExtension})${suffix}`;
}

function formatSymbolicLinkDetail(symbolicLink: number): null | string {
    if (symbolicLink <= 0) {
        return null;
    }

    return `symbolic links (${symbolicLink})`;
}
