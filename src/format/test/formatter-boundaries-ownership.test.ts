import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";

void describe("formatter boundaries ownership", () => {
    void it("does not apply semantic/content rewrites during formatting", async () => {
        const source = [
            "#macro VALUE 1;",
            "var cfg = {};",
            "cfg.foo = 1;",
            "cfg.bar = 2;",
            'var label = "HP: " + string(hp);',
            "var ratio = total / 2;",
            "globalvar score;",
            "score = 1;",
            "var item = lst_items[? 0];",
            "if ((ready && armed) || override) {",
            "    show_debug_message(label);",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(formatted, /#macro VALUE 1;/);
        assert.match(formatted, /cfg\.foo = 1;/);
        assert.match(formatted, /cfg\.bar = 2;/);
        assert.match(formatted, /"HP: " \+ string\(hp\)/);
        assert.match(formatted, /total \/ 2/);
        assert.match(formatted, /globalvar score;/);
        assert.match(formatted, /score = 1;/);
        assert.match(formatted, /lst_items\[\?\s*0]/);
        assert.doesNotMatch(formatted, /\$"HP:\s*\{hp\}"/);
        assert.doesNotMatch(formatted, /cfg\s*=\s*\{\s*foo:\s*1,\s*bar:\s*2\s*\}/);
        assert.doesNotMatch(formatted, /global\.score =/);
        assert.doesNotMatch(formatted, /lst_items\[\|\s*0]/);
    });

    void it("does not synthesize trailing optional defaults during formatting", async () => {
        const source = ["function demo(first, second = 1, third) {", "    return [first, second, third];", "}"].join(
            "\n"
        );
        const formatted = await Format.format(source);
        assert.match(formatted, /function demo\(first,\s*second = 1,\s*third\)/);
        assert.doesNotMatch(formatted, /third = undefined/);
    });

    void it("owns brace synthesis for single-statement control flow while leaving semantic rewrites to lint", async () => {
        const source = ['if (isGameStart) global.state = "RUNNING";', "if (isPaused) return;", ""].join("\n");

        const formatted = await Format.format(source, {
            allowInlineControlFlowBlocks: false
        });

        assert.match(formatted, /if \(isGameStart\) \{\n\s+global\.state = "RUNNING";\n\}/);
        assert.match(formatted, /if \(isPaused\) \{\n\s+return;\n\}/);
    });

    void it("does not synthesize identifier defaults while printing function parameters", async () => {
        const source = ["function synthesize_default(argument0) {", "    return argument0;", "}"].join("\n");

        const formatted = await Format.format(source);

        assert.match(formatted, /function synthesize_default\(argument0\)/);
        assert.doesNotMatch(
            formatted,
            /function synthesize_default\(argument0 = undefined\)/,
            "Formatter must not synthesize `= undefined` because optionality/content rewrites belong to lint."
        );
    });

    void it("does not strip non-undefined default parameter values from function declarations", async () => {
        const source = [
            "/// @function scr_dq_get_conjugate(dq, target_dq)",
            "/// @param {array} dq",
            "/// @param {array} target_dq",
            "function scr_dq_get_conjugate(dq, target_dq = array_create(8)) {",
            "    return target_dq;",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /function scr_dq_get_conjugate\(dq,\s*target_dq = array_create\(8\)\)/,
            "Formatter must preserve explicit non-undefined default expressions in function parameters."
        );
    });

    void it("preserves explicit undefined default parameter values from function declarations", async () => {
        const source = [
            "function vertex_position_3d_ext(vbuff, px = 0, py = 0, pz = 0, trans_mat = undefined) {",
            "    return [vbuff, px, py, pz, trans_mat];",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /function vertex_position_3d_ext\(vbuff,\s*px = 0,\s*py = 0,\s*pz = 0,\s*trans_mat = undefined\)/,
            "Formatter must preserve explicit `= undefined` default expressions in function parameters."
        );
    });

    void it("does not synthesize doc-comment tags during formatting", async () => {
        const source = [
            "function make_struct(value) {",
            "var result = {alpha:1,beta:value,gamma:call()};",
            "return result;",
            "}"
        ].join("\n");
        const formatted = await Format.format(source);
        assert.doesNotMatch(formatted, /^\/\/\/ @/m);
        assert.match(formatted, /function make_struct\(value\)/);
    });

    void it("preserves legacy /// @function annotations (formatter must not normalize to newer tags)", async () => {
        const source = [
            "/// @function update_ground_dist(ray_len)",
            "/// @description Updates ground distance each step",
            "/// @param ray_len {real} The ray length",
            "function update_ground_dist(ray_len) {",
            "return ray_len;",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /^\/\/\/ @function update_ground_dist\(ray_len\)/m,
            "Formatter must preserve legacy @function annotation text verbatim enough to keep tag ownership in lint."
        );
        assert.doesNotMatch(
            formatted,
            /^\/\/\/ @func update_ground_dist/m,
            "Formatter must not replace @function with alternate doc tags."
        );
    });

    void it("does not normalize legacy // @desc aliases to @description (normalization belongs in lint)", async () => {
        const source = ["// @desc Legacy summary", "function legacy_desc() {", "    return 1;", "}", ""].join("\n");

        const formatted = await Format.format(source);

        assert.match(formatted, /^\/\/ @desc Legacy summary$/m);
        assert.doesNotMatch(
            formatted,
            /^\/\/\/ @description Legacy summary$/m,
            "Formatter must not normalize legacy @desc tags; that is owned by gml/normalize-doc-comments in lint."
        );
    });

    void it("does not normalize standalone /// @tag alias lines (normalization belongs in lint)", async () => {
        // Standalone triple-slash doc-tag alias lines must be returned verbatim.
        // Content rewrites — tag-alias normalization (@func → @function,
        // @desc → @description, @return → @returns, @arg → @param) and
        // parameter-list stripping (/// @function name(args) → name) — are
        // owned exclusively by `gml/normalize-doc-comments` in @gmloop/lint.
        // (target-state.md §2.2, §3.2)
        const source = [
            "var x = 1;",
            "/// @func my_helper(a)",
            "/// @desc Returns a value",
            "/// @return {real}",
            "/// @arg {real} a",
            "var y = 2;",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /^\/\/\/ @func my_helper\(a\)$/m,
            "Formatter must not normalize @func to @function — that is a lint-workspace responsibility (gml/normalize-doc-comments)"
        );
        assert.match(
            formatted,
            /^\/\/\/ @desc Returns a value$/m,
            "Formatter must not normalize @desc to @description — that is a lint-workspace responsibility (gml/normalize-doc-comments)"
        );
        assert.match(
            formatted,
            /^\/\/\/ @return \{real\}$/m,
            "Formatter must not normalize @return to @returns — that is a lint-workspace responsibility (gml/normalize-doc-comments)"
        );
        assert.match(
            formatted,
            /^\/\/\/ @arg \{real\} a$/m,
            "Formatter must not normalize @arg to @param — that is a lint-workspace responsibility (gml/normalize-doc-comments)"
        );
    });

    void it("preserves canonical top-level doc-block comment body verbatim", async () => {
        const source = [
            "/**",
            " *   @description   Keep    exact   spacing.",
            " * @param value   spaced",
            " */",
            "function keep_doc(value) {",
            "    return value;",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /\*\*[\s\S]*\* {3}@description {3}Keep {4}exact {3}spacing\.[\s\S]*\* @param value {3}spaced[\s\S]*\*\//,
            "Formatter must preserve canonical doc-block content verbatim; text normalization belongs to lint rules."
        );
    });

    void it("does not upgrade legacy double-slash @function to triple-slash (normalization belongs in lint)", async () => {
        // Legacy double-slash `// @function` doc comments are normalised by the
        // lint rule `gml/normalize-doc-comments`, not the formatter. The formatter
        // must preserve the comment exactly as written and never silently convert
        // `// @function` to `/// @function`. (target-state.md §2.2, §3.2, §3.5)
        //
        // The parser's `normalizeFunctionDocCommentAttachments` still attaches the
        // comment to `node.docComments`; the formatter prints it verbatim.
        const source = [
            "// @function legacy_func(val)",
            "// @param val {real}",
            "function legacy_func(val) {",
            "    return val;",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        // The formatter must NOT silently upgrade the double-slash format.
        // That conversion belongs exclusively to @gmloop/lint.
        assert.doesNotMatch(
            formatted,
            /^\/\/\/ @function legacy_func/m,
            "Formatter must not upgrade // @function to /// @function — that is a lint-workspace responsibility (gml/normalize-doc-comments)"
        );
    });

    void it("does not rewrite explicit undefined defaults from raw legacy // @param text", async () => {
        const source = [
            "// @function legacy_optional(val)",
            "// @param [val] {real}",
            "function legacy_optional(val = undefined) {",
            "    return val;",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /function legacy_optional\(val = undefined\)/,
            "Formatter must preserve explicit `= undefined` defaults and must not perform semantic optionality rewrites from raw legacy // comments."
        );
    });

    void it("never synthesizes function doc-comments for declarations or function assignments", async () => {
        const source = [
            "function declared(alpha, beta) {",
            "return alpha + beta;",
            "}",
            "",
            "var assigned = function(gamma) {",
            "return gamma * 2;",
            "};"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.doesNotMatch(
            formatted,
            /^\/\/\/ @(?:description|function|func|param|returns?)\b/m,
            "Formatter must not synthesize any function doc-comment tags; this is lint-only behavior."
        );
        assert.match(formatted, /function declared\(alpha,\s*beta\)/);
        assert.match(formatted, /var assigned = function \(gamma\)/);
    });

    void it("does not promote plain leading comments into synthetic /// @description tags", async () => {
        const source = [
            "// This function computes a score.",
            "function compute_score(points) {",
            "return points;",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(formatted, /^\/\/ This function computes a score\./m);
        assert.doesNotMatch(
            formatted,
            /^\/\/\/ @description\b/m,
            "Formatter must not synthesize @description from plain leading comments."
        );
        assert.doesNotMatch(
            formatted,
            /^\/\/\/ @(?:function|func|param|returns?)\b/m,
            "Formatter must not synthesize function doc-comment tags."
        );
    });

    void it("fails fast on invalid syntax instead of repairing parse input", async () => {
        const malformedSource = 'if (ready) {\n    show_debug_message("x");\n';

        await assert.rejects(async () => {
            await Format.format(malformedSource);
        });
    });

    void it("never mutates malformed comment text as a parser recovery strategy", async () => {
        const malformedCommentSource = "/ @description not-valid-comment\nvar value = 1;";

        await assert.rejects(async () => {
            await Format.format(malformedCommentSource);
        });

        assert.strictEqual(malformedCommentSource, "/ @description not-valid-comment\nvar value = 1;");
    });

    void it("does not remove duplicate doc-comment lines (deduplication belongs in lint)", async () => {
        // Formatter must not perform content rewrites. Removing duplicate doc
        // comment lines is a semantic operation owned by `@gmloop/lint`
        // (target-state.md §2.2, §3.2).
        const source = [
            "/// @description Updates the ground distance",
            "/// @description Updates the ground distance",
            "function update_ground_dist() {",
            "    return 1;",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);
        const docLineCount = (formatted.match(/\/\/\/ @description Updates the ground distance/g) ?? []).length;

        assert.strictEqual(
            docLineCount,
            2,
            "Formatter must not strip duplicate doc-comment lines — that is a lint-workspace responsibility"
        );
    });

    void it("does not remove default placeholder comments (cleanup belongs in lint)", async () => {
        const source = [
            "// Script assets have changed for v2.3.0 see",
            "// https://help.yoyogames.com/hc/en-us/articles/360005277377 for more information",
            "function demo() {",
            "    return 1;",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(formatted, /^\/\/ Script assets have changed for v2\.3\.0 see/m);
        assert.match(
            formatted,
            /^\/\/ https:\/\/help\.yoyogames\.com\/hc\/en-us\/articles\/360005277377 for more information/m
        );
    });

    void it("keeps @function doc comments attached to the following function target", async () => {
        const source = [
            "var unrelated_value = 1;",
            "",
            "/// @function scr_target",
            "function scr_target() {",
            "    return unrelated_value;",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(formatted, /var unrelated_value = 1;/);
        assert.match(
            formatted,
            /\/\/\/ @function scr_target\s*\nfunction scr_target\(\)/,
            "Function-tag doc comments should stay attached to the function declaration."
        );
    });

    void it("does not rename argumentN parameters based on @function doc-comment tags", async () => {
        // Renaming `argument0`-style parameters to their doc-comment preferred names is a
        // semantic content rewrite that belongs in `@gmloop/lint`, not the formatter.
        // The formatter must preserve the original identifier names verbatim.
        // (target-state.md §2.2, §3.2 — "Formatter must not perform semantic/content rewrites")
        const source = [
            "/// @function draw_bezier(x1, y1, x2, y2)",
            "function draw_bezier(argument0, argument1, argument2, argument3) {",
            "    var x1 = argument0;",
            "    var y1 = argument1;",
            "    draw_line(x1, y1, argument2, argument3);",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /function draw_bezier\(argument0,\s*argument1,\s*argument2,\s*argument3\)/,
            "Formatter must not rename argumentN parameters — that is a lint-workspace responsibility"
        );
        assert.match(formatted, /var x1 = argument0;/, "Formatter must not filter argument alias declarations");
        assert.match(formatted, /var y1 = argument1;/, "Formatter must not filter argument alias declarations");
        assert.doesNotMatch(
            formatted,
            /^function draw_bezier\(x1,\s*y1/m,
            "Formatter must not rename parameters from @function tag"
        );
    });

    void it("does not simplify if/else boolean returns (semantic rewrites belong in lint)", async () => {
        // The formatter must not transform `if (cond) { return true; } else { return false; }`
        // into `return cond;`. That is a semantic/structural content rewrite owned exclusively
        // by the `@gmloop/lint` `gml/optimize-logical-flow` rule.
        // (target-state.md §2.2, §3.2 — "Format must not perform semantic/content rewrites")
        const source = [
            "function bool_passthrough(condition) {",
            "    if (condition) {",
            "        return true;",
            "    } else {",
            "        return false;",
            "    }",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.doesNotMatch(
            formatted,
            /return condition;/,
            "Formatter must not simplify if/else boolean returns — that is a lint-workspace responsibility (gml/optimize-logical-flow)"
        );
        assert.match(formatted, /if \(condition\)/);
        assert.match(formatted, /return true;/);
        assert.match(formatted, /return false;/);
    });

    void it("does not simplify negated if/else boolean returns (semantic rewrites belong in lint)", async () => {
        // The formatter must not transform `if (cond) { return false; } else { return true; }`
        // into `return !cond;`. That is a semantic/structural content rewrite owned exclusively
        // by the `@gmloop/lint` `gml/optimize-logical-flow` rule.
        const source = [
            "function bool_negated(condition) {",
            "    if (condition) {",
            "        return false;",
            "    } else {",
            "        return true;",
            "    }",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.doesNotMatch(
            formatted,
            /return !condition;/,
            "Formatter must not negate boolean return conditions — that is a lint-workspace responsibility (gml/optimize-logical-flow)"
        );
        assert.match(formatted, /if \(condition\)/);
        assert.match(formatted, /return false;/);
        assert.match(formatted, /return true;/);
    });

    void it("does not add semantic blank-line padding between boolean return paths", async () => {
        // Inserting an extra blank line between `if (...) { return true; }` and a
        // following `return false;` depends on interpreting the control-flow
        // meaning of the statements. That semantic presentation choice belongs in
        // lint, not in the formatter's statement-spacing policy.
        const source = [
            "function bool_guard(condition) {",
            "    if (condition) {",
            "        return true;",
            "    }",
            "    return false;",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.equal(
            formatted.includes("return true;\n    }\n\n    return false;"),
            false,
            "Formatter must not insert semantic blank-line padding between opposing boolean returns."
        );
        assert.equal(formatted.includes("return true;\n    }\n    return false;"), true);
    });

    void it("does not apply math optimizations during formatting", async () => {
        const source = ["var division = 1 / 2;", "var multiplication = 2 * 2;"].join("\n");

        const formatted = await Format.format(source);

        assert.match(formatted, /var division = 1 \/ 2;/);
        assert.match(formatted, /var multiplication = 2 \* 2;/);
    });

    void it("preserves function declarations with no parameters", async () => {
        const source = ["function demo() {", "    return 42;", "}", ""].join("\n");

        const formatted = await Format.format(source);

        assert.ok(formatted.includes("function demo()"), "formatter should preserve function declaration");
        assert.ok(formatted.includes("return 42"), "formatter should preserve function body");
        assert.strictEqual(
            formatted,
            ["function demo() {", "    return 42;", "}", ""].join("\n"),
            "formatter should produce consistent output"
        );
    });

    void it("formatting retains numbered arguments", async () => {
        const source = [
            "/// @param first",
            "function sample() {",
            "    var first = argument0;",
            "    return argument0;",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.strictEqual(
            formatted,
            [
                "/// @param first",
                "function sample() {",
                "    var first = argument0;",
                "    return argument0;",
                "}",
                ""
            ].join("\n")
        );
    });

    void it("keeps argument aliases even when a named parameter exists", async () => {
        const source = ["function sample(first) {", "    var alias = argument0;", "    return alias;", "}", ""].join(
            "\n"
        );

        const formatted = await Format.format(source);

        assert.strictEqual(
            formatted,
            ["function sample(first) {", "    var alias = argument0;", "    return alias;", "}", ""].join("\n")
        );
    });

    void it("does not strip empty /// @description doc-comment lines (cleanup belongs in lint)", async () => {
        // Removing empty `/// @description` tags is a doc-comment content rewrite
        // owned by `@gmloop/lint`'s `gml/normalize-doc-comments` rule
        // (target-state.md §2.2 — "Lint owns `@description` promotion/cleanup").
        // The formatter must preserve empty @description lines verbatim so that
        // lint can make an intentional, auditable decision about whether to remove them.
        const standaloneSource = ["/// @description", "function demo() {", "    return 1;", "}"].join("\n");

        const standaloneFormatted = await Format.format(standaloneSource);

        assert.match(
            standaloneFormatted,
            /^\/\/\/ @description\s*$/m,
            "Formatter must not strip empty /// @description tags — that is a lint-workspace responsibility (target-state.md §2.2)"
        );

        // Struct literal context: the formatter must preserve empty @description
        // as a leading doc-comment line on struct properties too.
        const structSource = [
            "var obj = {",
            "    /// @description",
            "    method: function () {",
            "        return 1;",
            "    }",
            "};",
            ""
        ].join("\n");

        const structFormatted = await Format.format(structSource);

        assert.match(
            structFormatted,
            /^[ \t]*\/\/\/ @description\s*$/m,
            "Formatter must not strip empty /// @description from struct literal properties — that is a lint-workspace responsibility (target-state.md §2.2)"
        );
    });

    void it("preserves multiline @description continuation text verbatim", async () => {
        const source = [
            "/// @description Build packet metadata",
            "/// first line",
            "///   nested details",
            "///",
            "/// @param value",
            "function build_packet(value) {",
            "    return value;",
            "}"
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /^\/\/\/ @description Build packet metadata\n\/\/\/ first line\n\/\/\/ {3}nested details\n\/\/\/\n\/\/\/ @param value/m,
            "Formatter must preserve multiline @description continuation text verbatim without formatter-owned alignment."
        );
    });

    void it("does not move top-of-file empty /// @description onto plain variable declarations", async () => {
        const source = [
            "/// @description",
            "",
            "// Cast a ray from high above to the ground so that the coin is placed onto the ground",
            "var ray = cm_cast_ray(levelColmesh, cm_ray(x, y, 1000, x, y, -100));",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /^\/\/\/ @description\s*\n\n\/\/ Cast a ray from high above to the ground so that the coin is placed onto the ground/m
        );
        assert.doesNotMatch(
            formatted,
            /^\/\/ Cast a ray from high above to the ground so that the coin is placed onto the ground\s*\n\/\/\/ @description\s*\nvar ray/m
        );
    });

    void it("preserves blank lines between doc tags instead of inferring description/function grouping", async () => {
        const source = [
            "/// @description Build a packet",
            "",
            "/// @function build_packet(value)",
            "/// @param value",
            "function build_packet(value) {",
            "    return value;",
            "}",
            ""
        ].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /^\/\/\/ @description Build a packet\s*\n\n\/\/\/ @function build_packet\(value\)/m,
            "Formatter must preserve source blank lines between doc tags; grouping @description with @function is lint-owned doc normalization."
        );
    });

    void it("does not synthesize empty /// @description tags for undocumented functions", async () => {
        const source = ["function no_docs() {", "    return 1;", "}", ""].join("\n");
        const formatted = await Format.format(source);

        assert.doesNotMatch(
            formatted,
            /^\/\/\/ @description\s*$/m,
            "Formatter must not synthesize empty /// @description tags."
        );
    });

    void it("preserves global. accessor prefix — does not strip it when globalvar declaration is present (§2.1/§3.2)", async () => {
        // Stripping `global.foo` to bare `foo` when `globalvar foo;` is present is a
        // semantic/content rewrite: it changes program meaning based on AST structure.
        // The formatter must preserve source content as-is; renaming/removing `global.`
        // prefixes belongs in the lint workspace (`gml/no-globalvar` rule).
        const source = ["globalvar score;", "global.score = 100;", "show_debug_message(global.score);"].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /global\.score = 100;/,
            "Formatter must not strip `global.` from `global.score` even when `globalvar score;` is present."
        );
        assert.match(
            formatted,
            /show_debug_message\(global\.score\)/,
            "Formatter must not strip `global.` from `global.score` in expressions."
        );
        assert.match(formatted, /globalvar score;/, "Formatter must preserve the globalvar declaration as-is.");
    });

    void it("preserves source blank-line layout before banner comments", async () => {
        // preserveBannerSpacingGaps was a post-Prettier patch that inspected `source`
        // to conditionally add blank lines before banner-comment patterns.  This made
        // the formatter non-deterministic: two files with identical logical structure
        // but different surrounding whitespace would produce different output.
        // The function has been removed; blank-line placement before top-level comments
        // is now handled deterministically by `normalizeFormattedOutput` (called
        // downstream by the CLI).  target-state.md §3.2: "Formatter must not perform
        // semantic/content rewrites or syntax repair."
        const sourceWithGap = [
            "var a = 1;",
            "",
            "////////////////////////////////////////",
            "// Section header",
            "////////////////////////////////////////",
            "var b = 2;",
            ""
        ].join("\n");

        const sourceWithoutGap = [
            "var a = 1;",
            "////////////////////////////////////////",
            "// Section header",
            "////////////////////////////////////////",
            "var b = 2;",
            ""
        ].join("\n");

        const formattedWithGap = await Format.format(sourceWithGap);
        const formattedWithoutGap = await Format.format(sourceWithoutGap);

        assert.notEqual(formattedWithGap, formattedWithoutGap);
    });

    void it("does not return source verbatim for files without trailing newline — formatter always normalises (§3.2)", async () => {
        // preserveTrailingNewlineForVerbatimTopLevelMultilineBlockComment was a
        // recovery fallback that returned `source` unchanged when Prettier's only
        // change was adding a trailing newline to a top-level block comment file.
        // Returning the raw source violates target-state.md §3.2: "The formatter
        // must never attempt recovery or fallback printing."
        //
        // The function has been removed; `format()` now delegates entirely to
        // `prettier.format()` without inspecting source to patch the result.
        const sourceWithoutTrailingNewline = ["/*", " * Top-level file header.", " */", "", "var x = 1"].join("\n");

        // Confirm the source does not end with a newline
        assert.equal(
            sourceWithoutTrailingNewline.endsWith("\n"),
            false,
            "Test precondition: source must not end with a newline."
        );

        const formatted = await Format.format(sourceWithoutTrailingNewline);

        // The formatter must add a trailing newline
        assert.equal(
            formatted.endsWith("\n"),
            true,
            "Formatter must produce output with a trailing newline, not return source verbatim (§3.2)."
        );

        // The formatted output must differ from the raw source (normalisation was applied)
        assert.notEqual(
            formatted,
            sourceWithoutTrailingNewline,
            "Formatter must not return source verbatim as a recovery fallback (§3.2)."
        );
    });

    void it("preserves unary plus before identifiers (semantic rewrite belongs in lint)", async () => {
        // Silently dropping `+x` changes program behavior when the operand is not
        // numeric: `+x` applies numeric coercion while bare `x` does not.
        // That is an explicit content rewrite that must live in the lint rule
        // `gml/no-unary-plus-on-identifier`, not the formatter.
        // (target-state.md §2.1, §3.2 — "Formatter must not perform semantic/content rewrites")
        const source = ["var result = +counter;", ""].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /\+counter/,
            "Formatter must not strip unary `+` from identifiers — that is a lint-workspace responsibility (gml/no-unary-plus-on-identifier)."
        );
        assert.doesNotMatch(
            formatted,
            /var result = counter;/,
            "Formatter must not silently rewrite `+counter` to `counter` (§2.1, §3.2)."
        );
    });

    void it("preserves unary minus before zero literals (semantic rewrite belongs in lint)", async () => {
        // Collapsing `-0` to `0` removes a unary operator, which is a structural
        // and semantic change — not a layout transform. The lint rule
        // `gml/no-negative-zero` now owns this rewrite.
        // (target-state.md §2.1, §3.2 — "Formatter must not perform semantic/content rewrites")
        const source = ["var x = -0;", ""].join("\n");

        const formatted = await Format.format(source);

        assert.match(
            formatted,
            /-0/,
            "Formatter must preserve `-0` verbatim — collapsing to `0` is a lint-workspace responsibility (gml/no-negative-zero)."
        );
        assert.doesNotMatch(formatted, /var x = 0;/, "Formatter must not silently rewrite `-0` to `0` (§2.1, §3.2).");
    });
});
