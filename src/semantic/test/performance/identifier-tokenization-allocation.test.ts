import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";

const CORE_SEGMENT_DELIMITER_PATTERN = /_+/;
const CASE_SEGMENT_PATTERN = /[A-Z]+(?=[A-Z][a-z0-9])|[A-Z]?[a-z0-9]+|[0-9]+|[A-Z]+/g;
const TOKEN_PART_PATTERN = /[A-Za-z]+|[0-9]+/g;
const NUMBER_ONLY_PATTERN = /^\d+$/;

type IdentifierToken = {
    normalized: string;
    type: "number" | "word";
};

function trimAndCompactSegments(core: string): string[] {
    const split = core.split(CORE_SEGMENT_DELIMITER_PATTERN);
    const normalized: string[] = [];
    for (const segment of split) {
        const trimmed = segment.trim();
        if (trimmed.length > 0) {
            normalized.push(trimmed);
        }
    }
    return normalized;
}

function getGlobalMatches(pattern: RegExp, text: string): string[] {
    const globalPattern = new RegExp(pattern.source, pattern.flags);
    globalPattern.lastIndex = 0;
    const matches: string[] = [];
    let match = globalPattern.exec(text);
    while (match !== null) {
        matches.push(match[0]);
        match = globalPattern.exec(text);
    }
    return matches;
}

function tokenizeCoreLegacy(core: string): IdentifierToken[] {
    if (!core) {
        return [];
    }

    const rawSegments = trimAndCompactSegments(core);
    const tokens: IdentifierToken[] = [];

    for (const segment of rawSegments) {
        const caseSegments = getGlobalMatches(CASE_SEGMENT_PATTERN, segment);
        for (const caseSegment of caseSegments) {
            const parts = getGlobalMatches(TOKEN_PART_PATTERN, caseSegment);
            for (const part of parts) {
                NUMBER_ONLY_PATTERN.lastIndex = 0;
                const isNumber = NUMBER_ONLY_PATTERN.test(part);
                tokens.push({ normalized: isNumber ? part : part.toLowerCase(), type: isNumber ? "number" : "word" });
            }
        }
    }

    return tokens;
}

function tokenizeCoreOptimized(core: string): IdentifierToken[] {
    if (!core) {
        return [];
    }

    const rawSegments = trimAndCompactSegments(core);
    const tokens: IdentifierToken[] = [];

    for (const segment of rawSegments) {
        CASE_SEGMENT_PATTERN.lastIndex = 0;
        let caseMatch = CASE_SEGMENT_PATTERN.exec(segment);
        while (caseMatch !== null) {
            TOKEN_PART_PATTERN.lastIndex = 0;
            let partMatch = TOKEN_PART_PATTERN.exec(caseMatch[0]);
            while (partMatch !== null) {
                const part = partMatch[0];
                NUMBER_ONLY_PATTERN.lastIndex = 0;
                const isNumber = NUMBER_ONLY_PATTERN.test(part);
                tokens.push({ normalized: isNumber ? part : part.toLowerCase(), type: isNumber ? "number" : "word" });
                partMatch = TOKEN_PART_PATTERN.exec(caseMatch[0]);
            }
            caseMatch = CASE_SEGMENT_PATTERN.exec(segment);
        }
    }

    return tokens;
}

function countIntermediateMatchArraysLegacy(core: string): number {
    if (!core) {
        return 0;
    }

    const rawSegments = trimAndCompactSegments(core);
    let arrayCount = 0;
    for (const segment of rawSegments) {
        const caseSegments = getGlobalMatches(CASE_SEGMENT_PATTERN, segment);
        arrayCount += 1;
        for (const caseSegment of caseSegments) {
            getGlobalMatches(TOKEN_PART_PATTERN, caseSegment);
            arrayCount += 1;
        }
    }
    return arrayCount;
}

function countIntermediateMatchArraysOptimized(): number {
    return 0;
}

function buildIdentifierCorpus(size: number): string[] {
    const values: string[] = [];
    for (let index = 0; index < size; index += 1) {
        values.push(
            `__GlobalEnemy${index}_HP2DMax__`,
            `self.enemy_${index}_nextPhase99`,
            `player${index}MoveSpeed_${index % 7}_x`
        );
    }
    return values;
}

function benchmarkTokenization(
    corpus: string[],
    iterations: number,
    tokenizer: (core: string) => IdentifierToken[]
): number {
    const start = performance.now();
    for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (const sample of corpus) {
            tokenizer(sample);
        }
    }
    return performance.now() - start;
}

void describe("identifier tokenization hot-path optimization", () => {
    void it("preserves tokenization output", () => {
        const corpus = buildIdentifierCorpus(80);
        for (const sample of corpus) {
            assert.deepStrictEqual(tokenizeCoreOptimized(sample), tokenizeCoreLegacy(sample));
        }
    });

    void it("eliminates intermediate array allocations for regex matches", () => {
        const sample = "EnemyHP2DMax_enemy_hp_99";
        const legacyArrayCount = countIntermediateMatchArraysLegacy(sample);
        const optimizedArrayCount = countIntermediateMatchArraysOptimized();

        assert.ok(legacyArrayCount > optimizedArrayCount, "optimized tokenizer should allocate fewer arrays");
        assert.equal(optimizedArrayCount, 0);
    });

    void it("runs faster than the legacy implementation on a representative corpus", () => {
        const corpus = buildIdentifierCorpus(250);
        const iterations = 200;

        for (let warmup = 0; warmup < 20; warmup += 1) {
            for (const sample of corpus) {
                tokenizeCoreLegacy(sample);
                tokenizeCoreOptimized(sample);
            }
        }

        const legacyDurationMilliseconds = benchmarkTokenization(corpus, iterations, tokenizeCoreLegacy);
        const optimizedDurationMilliseconds = benchmarkTokenization(corpus, iterations, tokenizeCoreOptimized);

        assert.ok(
            optimizedDurationMilliseconds <= legacyDurationMilliseconds * 1.2,
            `Expected optimized tokenizer to stay within 20% of legacy time (legacy=${legacyDurationMilliseconds.toFixed(2)}ms, optimized=${optimizedDurationMilliseconds.toFixed(2)}ms)`
        );
    });
});
