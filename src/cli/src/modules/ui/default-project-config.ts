/**
 * Create the default `gmloop.json` payload used by the graph UI.
 */
export function createDefaultGmloopProjectConfig(): Readonly<Record<string, unknown>> {
    return Object.freeze({
        allowInlineControlFlowBlocks: true,
        logicalOperatorsStyle: "keywords",
        lintRuleset: "recommended",
        printWidth: 120,
        refactor: Object.freeze({
            codemods: Object.freeze({
                docCommentAlignment: Object.freeze({}),
                globalvarToGlobal: Object.freeze({}),
                loopLengthHoisting: Object.freeze({}),
                namingConvention: Object.freeze({
                    exclusivePrefixes: Object.freeze({
                        curve_: "animationCurveResourceName",
                        fnt_: "fontResourceName",
                        obj_: "objectResourceName",
                        ps_: "particleSystemResourceName",
                        pth_: "pathResourceName",
                        rm_: "roomResourceName",
                        seq_: "sequenceResourceName",
                        shd_: "shaderResourceName",
                        snd_: "audioResourceName",
                        spr_: "spriteResourceName",
                        tile_: "tilesetResourceName",
                        tl_: "timelineResourceName"
                    }),
                    rules: Object.freeze({
                        animationCurveResourceName: Object.freeze({ prefix: "curve_" }),
                        audioResourceName: Object.freeze({ prefix: "snd_" }),
                        enum: Object.freeze({ caseStyle: "camel", prefix: "e" }),
                        enumMember: Object.freeze({ caseStyle: "upper_snake" }),
                        fontResourceName: Object.freeze({ prefix: "fnt_" }),
                        macro: Object.freeze({ caseStyle: "upper_snake" }),
                        objectResourceName: Object.freeze({ prefix: "obj_" }),
                        particleSystemResourceName: Object.freeze({ prefix: "ps_" }),
                        pathResourceName: Object.freeze({ prefix: "pth_" }),
                        resource: Object.freeze({ caseStyle: "lower_snake" }),
                        roomResourceName: Object.freeze({ prefix: "rm_" }),
                        sequenceResourceName: Object.freeze({ prefix: "seq_" }),
                        shaderResourceName: Object.freeze({ prefix: "shd_" }),
                        spriteResourceName: Object.freeze({ prefix: "spr_" }),
                        structDeclaration: Object.freeze({ caseStyle: "pascal" }),
                        tilesetResourceName: Object.freeze({ prefix: "tile_" }),
                        timelineResourceName: Object.freeze({ prefix: "tl_" }),
                        variable: Object.freeze({ caseStyle: "lower_snake" })
                    })
                }),
                repairArgumentSeparators: Object.freeze({}),
                repairLogicalNot: Object.freeze({}),
                scientificNotation: Object.freeze({})
            })
        }),
        semi: true,
        tabWidth: 4
    });
}
