import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Refactor } from "../index.js";

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
                loopLengthHoisting: {
                    functionSuffixes: {
                        array_length: "len"
                    }
                }
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
                loopLengthHoisting: {
                    functionSuffixes: {
                        array_length: "len"
                    }
                }
            }
        });
    } finally {
        await rm(path.dirname(configPath), { recursive: true, force: true });
    }
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
