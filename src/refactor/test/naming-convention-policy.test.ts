import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

void test("resolveNamingConventionRules applies inheritance and explicit disablement", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            variable: {
                caseStyle: "camel",
                bannedPrefixes: ["_"]
            },
            typeName: {
                caseStyle: "pascal"
            },
            member: {
                suffix: "_member"
            },
            globalVariable: {
                prefix: "g_"
            },
            loopIndexVariable: false
        },
        exclusivePrefixes: {
            g_: "globalVariable"
        }
    });

    const resolved = Refactor.resolveNamingConventionRules(policy);

    assert.equal(resolved.globalVariable?.prefix, "g_");
    assert.equal(resolved.globalVariable?.suffix, "");
    assert.equal(resolved.globalVariable?.caseStyle, "camel");
    assert.equal(resolved.globalVariable?.minChars, null);
    assert.equal(resolved.globalVariable?.maxChars, null);
    assert.deepEqual(resolved.globalVariable?.bannedPrefixes, ["_"]);
    assert.deepEqual(resolved.globalVariable?.bannedSuffixes, []);
    assert.equal(resolved.structDeclaration?.caseStyle, "pascal");
    assert.equal(resolved.constructorFunction?.caseStyle, "pascal");
    assert.equal(resolved.enum?.caseStyle, "pascal");
    assert.equal(resolved.enumMember?.suffix, "_member");
    assert.equal(resolved.loopIndexVariable, undefined);
});

void test("evaluateNamingConvention suggests case and prefix fixes", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            variable: {
                caseStyle: "camel"
            },
            globalVariable: {
                prefix: "g_"
            }
        }
    });

    const evaluation = Refactor.evaluateNamingConvention(
        "g_player_hp",
        "globalVariable",
        policy,
        Refactor.resolveNamingConventionRules(policy)
    );

    assert.equal(evaluation.compliant, false);
    assert.equal(evaluation.suggestedName, "g_playerHp");
    assert.match(evaluation.message ?? "", /camel case/);
});

void test("evaluateNamingConvention capitalizes the core when camel case uses an attached prefix", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            enum: {
                prefix: "e",
                caseStyle: "camel"
            }
        }
    });
    const resolved = Refactor.resolveNamingConventionRules(policy);

    const underscored = Refactor.evaluateNamingConvention("INPUT_VIRTUAL_TYPE", "enum", policy, resolved);
    assert.equal(underscored.compliant, false);
    assert.equal(underscored.suggestedName, "eInputVirtualType");

    const alreadyAttached = Refactor.evaluateNamingConvention("einputVirtualType", "enum", policy, resolved);
    assert.equal(alreadyAttached.compliant, false);
    assert.equal(alreadyAttached.suggestedName, "eInputVirtualType");

    const compliant = Refactor.evaluateNamingConvention("eInputVirtualType", "enum", policy, resolved);
    assert.equal(compliant.compliant, true);
    assert.equal(compliant.suggestedName, "eInputVirtualType");
});

void test("evaluateNamingConvention blocks automatic renames when min or max length is violated", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            localVariable: {
                caseStyle: "camel",
                minChars: 4,
                maxChars: 8
            }
        }
    });
    const resolved = Refactor.resolveNamingConventionRules(policy);

    const tooShort = Refactor.evaluateNamingConvention("id", "localVariable", policy, resolved);
    const tooLong = Refactor.evaluateNamingConvention("veryLongName", "localVariable", policy, resolved);

    assert.equal(tooShort.suggestedName, null);
    assert.match(tooShort.message ?? "", /minimum core length/);
    assert.equal(tooLong.suggestedName, null);
    assert.match(tooLong.message ?? "", /maximum core length/);
});

void test("evaluateNamingConvention reports reserved affix violations", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            localVariable: {
                caseStyle: "camel"
            },
            globalVariable: {
                prefix: "g_"
            }
        },
        exclusivePrefixes: {
            g_: "globalVariable"
        }
    });

    const evaluation = Refactor.evaluateNamingConvention(
        "g_localValue",
        "localVariable",
        policy,
        Refactor.resolveNamingConventionRules(policy)
    );

    assert.equal(evaluation.compliant, false);
    assert.equal(evaluation.suggestedName, "localValue");
    assert.match(evaluation.message ?? "", /reserved prefix/);
});

void test("evaluateNamingConvention strips banned affixes before applying case style", () => {
    // Exercises the third-priority branch in stripOneAffixDirection: when the identifier
    // carries a banned prefix or suffix (not the required one, not an exclusive one), it is
    // stripped before the core name is case-checked and a suggestion is produced.
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            localVariable: {
                caseStyle: "camel",
                bannedPrefixes: ["m_", "_"],
                bannedSuffixes: ["_t"]
            }
        }
    });
    const resolved = Refactor.resolveNamingConventionRules(policy);

    const withBannedPrefix = Refactor.evaluateNamingConvention("m_player_hp", "localVariable", policy, resolved);
    assert.equal(withBannedPrefix.compliant, false);
    assert.equal(withBannedPrefix.suggestedName, "playerHp");
    assert.match(withBannedPrefix.message ?? "", /banned prefix/);

    const withBannedSuffix = Refactor.evaluateNamingConvention("playerHp_t", "localVariable", policy, resolved);
    assert.equal(withBannedSuffix.compliant, false);
    assert.equal(withBannedSuffix.suggestedName, "playerHp");
    assert.match(withBannedSuffix.message ?? "", /banned suffix/);
});

void test("formatNamingCaseStyle preserves allowed underscore affixes", () => {
    assert.equal(Refactor.formatNamingCaseStyle("__input_error", "lower_snake"), "__input_error");
    assert.equal(Refactor.formatNamingCaseStyle("_TargetShader", "lower_snake"), "_target_shader");
    assert.equal(Refactor.formatNamingCaseStyle("__Vector3", "pascal"), "__Vector3");
});

void test("formatNamingCaseStyle preserves compact digit-uppercase tokens in upper snake case", () => {
    assert.equal(Refactor.formatNamingCaseStyle("DPAD_4DIR", "upper_snake"), "DPAD_4DIR");
    assert.equal(Refactor.formatNamingCaseStyle("L2R", "upper_snake"), "L2R");
    assert.equal(Refactor.formatNamingCaseStyle("L2R_DEVANAGARI", "upper_snake"), "L2R_DEVANAGARI");
    assert.equal(Refactor.formatNamingCaseStyle("ONE_OVER_1M", "upper_snake"), "ONE_OVER_1M");
    assert.equal(
        Refactor.formatNamingCaseStyle("__INPUT_2D_CHECKER_STATIC_RESULT", "upper_snake"),
        "__INPUT_2D_CHECKER_STATIC_RESULT"
    );
});

void test("formatNamingCaseStyle fast-path preserves simple lower snake cores", () => {
    assert.equal(Refactor.formatNamingCaseStyle("already_snake_case", "lower_snake"), "already_snake_case");
    assert.equal(Refactor.formatNamingCaseStyle("already_snake_case", "camel"), "alreadySnakeCase");
});

void test("evaluateNamingConvention preserves allowed leading underscores when enforcing case style", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            resource: {
                caseStyle: "lower_snake"
            }
        }
    });
    const resolved = Refactor.resolveNamingConventionRules(policy);

    const compliant = Refactor.evaluateNamingConvention("__input_error", "scriptResourceName", policy, resolved);
    assert.equal(compliant.compliant, true);
    assert.equal(compliant.suggestedName, "__input_error");

    const needsCaseFix = Refactor.evaluateNamingConvention("_TargetShader", "shaderResourceName", policy, resolved);
    assert.equal(needsCaseFix.compliant, false);
    assert.equal(needsCaseFix.suggestedName, "_target_shader");
});

void test("evaluateNamingConvention replaces underscore resource prefixes for shader resources", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            resource: {
                caseStyle: "lower_snake"
            },
            shaderResourceName: {
                prefix: "shd_"
            }
        }
    });
    const resolved = Refactor.resolveNamingConventionRules(policy);

    const evaluation = Refactor.evaluateNamingConvention("sh_cm_debug", "shaderResourceName", policy, resolved);
    assert.equal(evaluation.compliant, false);
    assert.equal(evaluation.suggestedName, "shd_cm_debug");
});

void test("evaluateNamingConvention replaces legacy single-letter resource prefixes when target prefix extends them", () => {
    // Legacy resource prefixes such as "o" and "s" should be replaced (not duplicated)
    // when the configured target prefix extends them (for example "obj_" or "spr_").
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            resource: {
                caseStyle: "lower_snake"
            },
            objectResourceName: {
                prefix: "obj_"
            },
            spriteResourceName: {
                prefix: "spr_"
            }
        }
    });
    const resolved = Refactor.resolveNamingConventionRules(policy);

    const camera = Refactor.evaluateNamingConvention("oCamera", "objectResourceName", policy, resolved);
    assert.equal(camera.compliant, false);
    assert.equal(camera.suggestedName, "obj_camera");

    const compound = Refactor.evaluateNamingConvention("oColmesh2DemoCylinder", "objectResourceName", policy, resolved);
    assert.equal(compound.compliant, false);
    assert.equal(compound.suggestedName, "obj_colmesh2demo_cylinder");

    const sprite = Refactor.evaluateNamingConvention("sSpiderHead", "spriteResourceName", policy, resolved);
    assert.equal(sprite.compliant, false);
    assert.equal(sprite.suggestedName, "spr_spider_head");

    // Underscore-separated prefix "o_" IS stripped (that's a real prefix, not a word).
    const underscorePrefixed = Refactor.evaluateNamingConvention("o_camera", "objectResourceName", policy, resolved);
    assert.equal(underscorePrefixed.compliant, false);
    assert.equal(underscorePrefixed.suggestedName, "obj_camera");
});

void test("evaluateNamingConvention fast-path handles simple case-style-only rules", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            localVariable: {
                caseStyle: "camel"
            }
        }
    });
    const resolved = Refactor.resolveNamingConventionRules(policy);

    const compliant = Refactor.evaluateNamingConvention("alreadyCamel", "localVariable", policy, resolved);
    assert.equal(compliant.compliant, true);
    assert.equal(compliant.suggestedName, "alreadyCamel");

    const needsRewrite = Refactor.evaluateNamingConvention("bad_name", "localVariable", policy, resolved);
    assert.equal(needsRewrite.compliant, false);
    assert.equal(needsRewrite.suggestedName, "badName");
    assert.match(needsRewrite.message ?? "", /camel case/);
});

void test("normalizeNamingConventionPolicy rejects unsupported naming categories", () => {
    assert.throws(
        () =>
            Refactor.normalizeNamingConventionPolicy({
                rules: {
                    eventHandlerFunction: {
                        caseStyle: "camel"
                    }
                }
            } as Parameters<typeof Refactor.normalizeNamingConventionPolicy>[0]),
        /unknown category/
    );
});

void test("resolveNamingConventionRules supports separate path and animation-curve categories", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            resource: {
                caseStyle: "lower"
            },
            pathResourceName: {
                prefix: "pth_"
            },
            animationCurveResourceName: {
                prefix: "curve_"
            }
        }
    });

    const resolved = Refactor.resolveNamingConventionRules(policy);

    assert.equal(resolved.pathResourceName?.prefix, "pth_");
    assert.equal(resolved.animationCurveResourceName?.prefix, "curve_");
    assert.equal(resolved.pathResourceName?.caseStyle, "lower");
    assert.equal(resolved.animationCurveResourceName?.caseStyle, "lower");
});

void test("resolveNamingConventionRules supports sequence, tileset, particle, note, and extension categories", () => {
    const policy = Refactor.normalizeNamingConventionPolicy({
        rules: {
            resource: {
                caseStyle: "lower"
            },
            sequenceResourceName: {
                prefix: "seq_"
            },
            tilesetResourceName: {
                prefix: "tile_"
            },
            particleSystemResourceName: {
                prefix: "part_"
            },
            noteResourceName: {
                prefix: "note_"
            },
            extensionResourceName: {
                prefix: "ext_"
            }
        }
    });

    const resolved = Refactor.resolveNamingConventionRules(policy);

    assert.equal(resolved.sequenceResourceName?.prefix, "seq_");
    assert.equal(resolved.tilesetResourceName?.prefix, "tile_");
    assert.equal(resolved.particleSystemResourceName?.prefix, "part_");
    assert.equal(resolved.noteResourceName?.prefix, "note_");
    assert.equal(resolved.extensionResourceName?.prefix, "ext_");
    assert.equal(resolved.sequenceResourceName?.caseStyle, "lower");
    assert.equal(resolved.tilesetResourceName?.caseStyle, "lower");
    assert.equal(resolved.particleSystemResourceName?.caseStyle, "lower");
    assert.equal(resolved.noteResourceName?.caseStyle, "lower");
    assert.equal(resolved.extensionResourceName?.caseStyle, "lower");
});
