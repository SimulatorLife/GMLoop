export interface ManualGeneratorBaseOptionValues {
    output?: string;
    manualRoot?: string;
    manualPackage?: string;
    quiet?: boolean;
}

export interface ManualGeneratorBaseOptions {
    outputPath: string;
    manualRoot: string | null;
    manualPackage: string | null;
    quiet: boolean;
}

/**
 * Normalize common CLI option values shared by manual-driven generators.
 */
export function normalizeManualGeneratorBaseOptions(
    options: ManualGeneratorBaseOptionValues,
    defaultOutputPath: string
): ManualGeneratorBaseOptions {
    return {
        outputPath: options.output ?? defaultOutputPath,
        manualRoot: options.manualRoot ?? null,
        manualPackage: options.manualPackage ?? null,
        quiet: Boolean(options.quiet)
    };
}
