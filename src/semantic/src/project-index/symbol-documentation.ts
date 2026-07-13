/** Structured documentation attached to one semantic symbol. */
export type GmlSymbolDocumentation = Readonly<{
    additionalTags: ReadonlyArray<Readonly<{ name: string; value: string }>>;
    description: string;
    normalizedText: string;
    parameters: ReadonlyArray<Readonly<{ description: string | null; name: string; type: string | null }>>;
    returns: Readonly<{ description: string | null; type: string | null }> | null;
}>;

const EMPTY_DOCUMENTATION: GmlSymbolDocumentation = Object.freeze({
    additionalTags: Object.freeze([]),
    description: "",
    normalizedText: "",
    parameters: Object.freeze([]),
    returns: null
});

/** Return the canonical empty documentation fact. */
export function createEmptyGmlSymbolDocumentation(): GmlSymbolDocumentation {
    return EMPTY_DOCUMENTATION;
}

/** Parse normalized GML documentation comment text into a semantic fact. */
export function parseGmlSymbolDocumentation(rawDocumentation: string): GmlSymbolDocumentation {
    const descriptions: string[] = [];
    const parameters: Array<Readonly<{ description: string | null; name: string; type: string | null }>> = [];
    const additionalTags: Array<Readonly<{ name: string; value: string }>> = [];
    let returns: GmlSymbolDocumentation["returns"] = null;
    const lines = rawDocumentation
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    for (const line of lines) {
        const parameter = /^@param(?:\s+\{([^}]+)\})?\s+(\w+)(?:\s+(.*))?$/u.exec(line);
        if (parameter) {
            parameters.push(
                Object.freeze({
                    name: parameter[2],
                    type: parameter[1] ?? null,
                    description: parameter[3] ?? null
                })
            );
            continue;
        }
        const returnValue = /^@returns?(?:\s+\{([^}]+)\})?(?:\s+(.*))?$/u.exec(line);
        if (returnValue) {
            returns = Object.freeze({ type: returnValue[1] ?? null, description: returnValue[2] ?? null });
            continue;
        }
        const description = /^@(desc|description)\s+(.*)$/u.exec(line);
        if (description) {
            descriptions.push(description[2]);
            continue;
        }
        const tag = /^@(\w+)\s*(.*)$/u.exec(line);
        if (tag) {
            additionalTags.push(Object.freeze({ name: tag[1], value: tag[2] }));
            continue;
        }
        descriptions.push(line);
    }

    return Object.freeze({
        additionalTags: Object.freeze(additionalTags),
        description: descriptions.join("\n\n"),
        normalizedText: lines.join("\n"),
        parameters: Object.freeze(parameters),
        returns
    });
}
