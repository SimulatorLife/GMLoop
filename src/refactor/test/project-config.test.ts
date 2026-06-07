import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Refactor } from "../index.js";
import { normalizeRefactorProjectConfigOrNull } from "../src/project-config.js";

/**
 * Write a temporary `gmloop.json` file and return its absolute path.
 */
async function writeConfigFile(config: Record<string, unknown>): Promise<string> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-config-"));
    const configPath = path.join(tempRoot, "gmloop.json");
    await writeFile(configPath, `${JSON.stringify(config, null, 4)}\n`, "utf8");
    return configPath;
}

void test("normalizeRefactorProjectConfig accepts a populated refactor section", async () => {
    const configPath = await writeConfigFile({
        refactor: {
            codemods: {
                namingConvention: {
                    rules: {
                        localVariable: {
                            caseStyle: "camel"
                        }
                    }
                },
                scientificNotation: {},
                docCommentAlignment: {}
            }
        }
    });

    try {
        const rawConfig = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
        const normalized = Refactor.normalizeRefactorProjectConfig(rawConfig.refactor);
        assert.deepEqual(normalized, {
            codemods: {
                namingConvention: {
                    rules: {
                        localVariable: {
                            caseStyle: "camel"
                        }
                    }
                },
                scientificNotation: {},
                docCommentAlignment: {}
            }
        });
    } finally {
        await rm(path.dirname(configPath), { recursive: true, force: true });
    }
});

void test("normalizeRefactorProjectConfig accepts loopLengthHoisting in project config", () => {
    const normalized = Refactor.normalizeRefactorProjectConfig({
        codemods: {
            loopLengthHoisting: {}
        }
    });
    assert.deepEqual(normalized, {
        codemods: {
            loopLengthHoisting: {}
        }
    });
});

void test("normalizeRefactorProjectConfig accepts loopLengthHoisting disabled via false", () => {
    const normalized = Refactor.normalizeRefactorProjectConfig({
        codemods: {
            loopLengthHoisting: false
        }
    });
    assert.deepEqual(normalized, {
        codemods: {
            loopLengthHoisting: false
        }
    });
});

void test("normalizeRefactorProjectConfig rejects malformed refactor sections", () => {
    assert.throws(
        () =>
            Refactor.normalizeRefactorProjectConfig({
                codemods: {
                    unknownCodemod: {}
                }
            }),
        {
            name: "TypeError",
            message: /Unknown refactor codemod/
        }
    );

    assert.throws(
        () =>
            Refactor.normalizeRefactorProjectConfig({
                codemods: {
                    namingConvention: {
                        rules: {
                            localVariable: {
                                caseStyle: "invalid"
                            }
                        }
                    }
                }
            }),
        {
            name: "TypeError",
            message: /caseStyle must be one of/
        }
    );
});

void test("normalizeRefactorProjectConfigOrNull returns null for unknown top-level keys", () => {
    const result = normalizeRefactorProjectConfigOrNull({
        codemods: {},
        unknownTopLevelKey: {}
    });
    assert.strictEqual(result, null);
});

void test("normalizeRefactorProjectConfigOrNull returns null for unknown codemod ids", () => {
    const result = normalizeRefactorProjectConfigOrNull({
        codemods: {
            unknownCodemod: {}
        }
    });
    assert.strictEqual(result, null);
});

void test("normalizeRefactorProjectConfigOrNull returns null for invalid codemod config values", () => {
    const result = normalizeRefactorProjectConfigOrNull({
        codemods: {
            namingConvention: {
                rules: {
                    localVariable: {
                        caseStyle: "invalid"
                    }
                }
            }
        }
    });
    assert.strictEqual(result, null);
});

void test("normalizeRefactorProjectConfigOrNull returns normalized config for valid inputs", () => {
    const result = normalizeRefactorProjectConfigOrNull({
        codemods: {
            scientificNotation: {},
            docCommentAlignment: {}
        }
    });
    assert.deepEqual(result, {
        codemods: {
            scientificNotation: {},
            docCommentAlignment: {}
        }
    });
});

void test("normalizeRefactorProjectConfigOrNull returns empty object for undefined config", () => {
    const result = normalizeRefactorProjectConfigOrNull(undefined);
    assert.deepEqual(result, {});
});

void test("normalizeRefactorProjectConfigOrNull returns null for non-object config", () => {
    assert.strictEqual(normalizeRefactorProjectConfigOrNull("not an object"), null);
    assert.strictEqual(normalizeRefactorProjectConfigOrNull(null), null);
    assert.strictEqual(normalizeRefactorProjectConfigOrNull(42), null);
});

void test("normalizeRefactorProjectConfigOrNull returns null for malformed codemods object", () => {
    const result = normalizeRefactorProjectConfigOrNull({
        codemods: "not an object"
    });
    assert.strictEqual(result, null);
});
