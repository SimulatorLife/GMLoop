import { test } from "node:test";

import { Core } from "@gmloop/core";

import { assertEquals } from "../assertions.js";

const NORMALIZATION_CASES = [
    {
        input: "/// @param {String Array[String]} value",
        expected: "/// @param {string,array[string]} value"
    },
    {
        input: "/// @param {string|Array[String]} value",
        expected: "/// @param {string,array[string]} value"
    },
    {
        input: "/// @param {Id Instance} value",
        expected: "/// @param {Id.Instance} value"
    },
    {
        input: "/// @param {Asset GMObject} value",
        expected: "/// @param {Asset.GMObject} value"
    },
    {
        input: "/// @param {Asset.GMSprite} value",
        expected: "/// @param {Asset.GMSprite} value"
    },
    {
        input: "/// @param {Constant Color} value",
        expected: "/// @param {Constant.Color} value"
    },
    {
        input: "/// @param {Constant.Colour} value",
        expected: "/// @param {Constant.Colour} value"
    },
    {
        input: "/// @param {Struct Weapon} value",
        expected: "/// @param {Struct.Weapon} value"
    },
    {
        input: "/// @param {array [ string ]} value",
        expected: "/// @param {array[string]} value"
    }
];

void test("normalizes GameMaker doc comment type annotations", () => {
    for (const { input, expected } of NORMALIZATION_CASES) {
        assertEquals(
            Core.normalizeDocCommentTypeAnnotations(input),
            expected,
            `Expected ${input} to normalize to ${expected}`
        );
    }
});

void test("applies JSDoc alias replacements without type normalization", () => {
    assertEquals(Core.applyJsDocTagAliasReplacements("/// @desc Example"), "/// @desc Example");
    assertEquals(Core.applyJsDocTagAliasReplacements("/// @arg value"), "/// @param value");
    assertEquals(Core.applyJsDocTagAliasReplacements("/// @params value"), "/// @param value");
    assertEquals(
        Core.applyJsDocTagAliasReplacements("/// @return {Boolean} should stay cased"),
        "/// @returns {Boolean} should stay cased"
    );
});

void test("JSDoc alias replacement passthrough keeps non-string inputs unchanged", () => {
    const marker = Object.freeze({ key: "value" });
    assertEquals(Core.applyJsDocTagAliasReplacements(marker), marker);
});

void test("doc comment type normalization resolver extends the defaults", () => {
    const guidInput = "/// @returns {Guid} value";
    assertEquals(Core.normalizeDocCommentTypeAnnotations(guidInput), "/// @returns {Guid} value");

    try {
        Core.setDocCommentTypeNormalizationResolver(() => ({
            synonyms: [
                ["guid", "string"],
                ["vec3", "vector3"]
            ],
            specifierPrefixes: ["resource"]
        }));

        assertEquals(Core.normalizeDocCommentTypeAnnotations(guidInput), "/// @returns {string} value");

        assertEquals(
            Core.normalizeDocCommentTypeAnnotations("/// @param {Resource Sprite} player"),
            "/// @param {Resource.Sprite} player"
        );

        assertEquals(
            Core.normalizeDocCommentTypeAnnotations("/// @param {Vec3} direction"),
            "/// @param {vector3} direction"
        );
    } finally {
        Core.restoreDefaultDocCommentTypeNormalizationResolver();
    }

    assertEquals(Core.normalizeDocCommentTypeAnnotations(guidInput), "/// @returns {Guid} value");
});

void test("doc comment normalization accepts entry-capable collaborators", () => {
    const synonymsEntries = {
        entries() {
            const values = [["Custom", "custom-normalized"]];
            return values[Symbol.iterator]();
        }
    };
    const prefixIterable = {
        *[Symbol.iterator]() {
            yield "Custom";
        }
    };
    try {
        Core.setDocCommentTypeNormalizationResolver(() => ({
            synonyms: synonymsEntries,
            specifierPrefixes: prefixIterable
        }));

        const normalization = Core.resolveDocCommentTypeNormalization();
        assertEquals(normalization.lookupTypeIdentifier("Custom"), "custom-normalized");
        assertEquals(normalization.getCanonicalSpecifierName("Custom"), "Custom");
        assertEquals(normalization.hasSpecifierPrefix("Custom"), true);
    } finally {
        Core.restoreDefaultDocCommentTypeNormalizationResolver();
    }
});

void test("doc comment normalization ignores invalid entry shapes", () => {
    const synonymsEntries = {
        entries() {
            return (function* () {
                yield "not-a-pair";
                yield { key: "Keyed", value: "value-normalized" };
                yield { 0: "Indexed", 1: "indexed-normalized" };
                yield { key: "MissingValue" };
            })();
        }
    };

    try {
        Core.setDocCommentTypeNormalizationResolver(() => ({
            synonyms: synonymsEntries
        }));

        const normalization = Core.resolveDocCommentTypeNormalization();
        assertEquals(normalization.lookupTypeIdentifier("Keyed"), "value-normalized");
        assertEquals(normalization.lookupTypeIdentifier("Indexed"), "indexed-normalized");
        assertEquals(normalization.lookupTypeIdentifier("MissingValue"), null);
        assertEquals(normalization.lookupTypeIdentifier("not-a-pair"), null);
    } finally {
        Core.restoreDefaultDocCommentTypeNormalizationResolver();
    }
});
