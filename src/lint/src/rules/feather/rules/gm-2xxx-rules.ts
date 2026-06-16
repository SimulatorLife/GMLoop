import type { Rule } from "eslint";

import { appendLineIfMissing, createFullTextRewriteRule, createMissingResetRule } from "../feather-rule-helpers.js";
import {
    DUPLICATE_GPU_POP_STATE_PATTERN,
    DUPLICATE_GPU_PUSH_STATE_PATTERN,
    GPU_ALPHA_TEST_TRUE_SPACING_PATTERN,
    VERTEX_BEGIN_WITHOUT_END_PATTERN
} from "../feather-rule-patterns.js";
import type { FeatherManifestEntry } from "../manifest.js";

export function createGm2000Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_set_blendmode\s*\(/, "gpu_set_blendmode(bm_normal);");
}

export function createGm2003Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bshader_set\s*\(/, "shader_reset();");
}

export function createGm2005Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(
            /if \(!surface_exists\(sf_canvas\)\)\s*\n\{/g,
            "if (!surface_exists(sf_canvas)) {"
        );
        rewritten = appendLineIfMissing(rewritten, "surface_reset_target();");
        return rewritten;
    });
}

export function createGm2007Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(
            /^([ \t]*var\s+[A-Za-z_][A-Za-z0-9_]*)(\s*\/\/[^\n]*)?$/gm,
            (_fullMatch, declaration: string, trailingComment?: string) => `${declaration};${trailingComment ?? ""}`
        );
        rewritten = rewritten.replaceAll(/(if\s*\([^\n]+\))\s*\n\{/g, "$1 {");
        return rewritten;
    });
}

export function createGm2008Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const beginCount = [...sourceText.matchAll(/\bvertex_begin\s*\(/g)].length;
        const endCount = [...sourceText.matchAll(/\bvertex_end\s*\(/g)].length;
        if (!/\bvertex_begin\s*\(/.test(sourceText) || beginCount <= endCount) {
            return sourceText;
        }

        return sourceText.replace(VERTEX_BEGIN_WITHOUT_END_PATTERN, "$1\nvertex_end(vb);\n");
    });
}

export function createGm2009Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/^\s*vertex_end\s*\([^)]*\)\s*;\s*/gm, "")
    );
}

export function createGm2011Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (sourceText.includes("vertex_end(vb);")) {
            return sourceText;
        }
        return appendLineIfMissing(sourceText, "vertex_end(vb);");
    });
}

export function createGm2012Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const lineEnding = sourceText.includes("\r\n") ? "\r\n" : "\n";
        const hasTerminalNewline = sourceText.endsWith("\n");
        const lines = sourceText.split(/\r?\n/u);
        const rewrittenLines: Array<string> = [];
        let activeBeginLineIndex: number | null = null;
        let activeBeginHasContent = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "vertex_format_add_position_3d();") {
                continue;
            }

            if (trimmed === "vertex_format_begin();") {
                if (activeBeginLineIndex !== null && !activeBeginHasContent) {
                    rewrittenLines.splice(activeBeginLineIndex, 1);
                }

                rewrittenLines.push(line);
                activeBeginLineIndex = rewrittenLines.length - 1;
                activeBeginHasContent = false;
                continue;
            }

            if (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*vertex_format_end\(\);\s*$/u.test(trimmed)) {
                rewrittenLines.push(line);
                activeBeginLineIndex = null;
                activeBeginHasContent = false;
                continue;
            }

            if (trimmed === "vertex_format_end();") {
                if (activeBeginLineIndex !== null && !activeBeginHasContent) {
                    rewrittenLines.splice(activeBeginLineIndex, 1);
                }

                activeBeginLineIndex = null;
                activeBeginHasContent = false;
                continue;
            }

            if (activeBeginLineIndex !== null && trimmed.length === 0) {
                continue;
            }

            if (activeBeginLineIndex !== null && trimmed.length > 0 && !trimmed.startsWith("//")) {
                activeBeginHasContent = true;
            }

            rewrittenLines.push(line);
        }

        let rewritten = rewrittenLines.join(lineEnding);
        rewritten = rewritten.replaceAll(new RegExp(`${lineEnding}{3,}`, "g"), `${lineEnding}${lineEnding}`);
        if (hasTerminalNewline && !rewritten.endsWith(lineEnding)) {
            rewritten = `${rewritten}${lineEnding}`;
        }

        return rewritten;
    });
}

export function createGm2015Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        const lines = sourceText.split(/\r?\n/u);
        const rewritten: Array<string> = [];
        let insertedTodo = false;
        for (const line of lines) {
            if (/^\s*vertex_format_/.test(line)) {
                if (!insertedTodo) {
                    rewritten.push("// TODO: Incomplete vertex format definition automatically commented out (GM2015)");
                    insertedTodo = true;
                }
                rewritten.push(`//${line}`);
                continue;
            }
            rewritten.push(line);
        }
        return rewritten.join("\n");
    });
}

export function createGm2020Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(
            /^(\s*)all\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+);\s*$/gm,
            (_fullMatch, indentation: string, identifier: string, valueExpression: string) =>
                `${indentation}with (all) {\n${indentation}    ${identifier} = ${valueExpression};\n${indentation}}`
        )
    );
}

export function createGm2023Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bdraw_set_alpha\s*\(/, "draw_set_alpha(1);");
}

export function createGm2025Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bdraw_set_color\s*\(/, "draw_set_color(c_white);");
}

export function createGm2026Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bdraw_set_halign\s*\(/, "draw_set_halign(fa_left);");
}

export function createGm2028Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/^\s*draw_primitive_end\s*\(\s*\)\s*;\s*/gm, "")
    );
}

export function createGm2029Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll("draw_primitive_begin();", "draw_primitive_begin(pr_trianglelist);");
        rewritten = rewritten.replaceAll(
            /draw_vertex\(([^)]+)\);\s*draw_vertex\(([^)]+)\);/g,
            "draw_vertex($1);\ndraw_vertex($2);"
        );

        const lines = rewritten.split(/\r?\n/u);
        const beginPattern = /^\s*draw_primitive_begin\s*\([^)]*\)\s*;\s*$/u;
        const endPattern = /^\s*draw_primitive_end\s*\(\s*\)\s*;\s*$/u;
        const vertexPattern = /^\s*draw_vertex\s*\(/u;
        const firstVertexIndex = lines.findIndex((line) => vertexPattern.test(line));
        if (firstVertexIndex === -1) {
            return rewritten;
        }

        const vertexIndent = /^(\s*)/u.exec(lines[firstVertexIndex])?.[1] ?? "";
        const beginLine = `${vertexIndent}draw_primitive_begin(pr_trianglelist);`;
        const endLine = `${vertexIndent}draw_primitive_end();`;
        const keptLines = lines.filter((line) => !beginPattern.test(line) && !endPattern.test(line));

        const insertBeginAt = keptLines.findIndex((line) => vertexPattern.test(line));
        if (insertBeginAt === -1) {
            return rewritten;
        }

        keptLines.splice(insertBeginAt, 0, beginLine);
        let lastVertexIndex = -1;
        for (let index = keptLines.length - 1; index >= 0; index -= 1) {
            if (vertexPattern.test(keptLines[index])) {
                lastVertexIndex = index;
                break;
            }
        }

        if (lastVertexIndex === -1) {
            return rewritten;
        }

        keptLines.splice(lastVertexIndex + 1, 0, endLine);
        return keptLines.join("\n");
    });
}

export function createGm2030Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        rewritten = rewritten.replace(/\n\}\nelse\s*\n\{/, "\n} else {");
        rewritten = rewritten.replaceAll(/^\s*draw_primitive_end\(\);\s*$/gm, "");
        rewritten = rewritten.replace(
            /(\}\s*)\n\ninstance_destroy\(\);/m,
            "$1\ndraw_primitive_end();\n\ninstance_destroy();"
        );
        return rewritten;
    });
}

export function createGm2031Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        const lines = rewritten.split(/\r?\n/u);

        // SAFETY: Use a while loop with an explicit index counter instead of
        // for...of + splice. After splice shifts elements left, the iterator index
        // becomes stale (off-by-one for every element after the splice point).
        // With a managed counter, index stays accurate even after splice.
        let index = 0;
        while (index < lines.length) {
            const line = lines[index];
            if (!/^\s*_file2\s*=\s*file_find_first\(/u.test(line)) {
                index += 1;
                continue;
            }

            let previousNonEmptyLineIndex = index - 1;
            while (previousNonEmptyLineIndex >= 0 && lines[previousNonEmptyLineIndex].trim().length === 0) {
                previousNonEmptyLineIndex -= 1;
            }

            if (previousNonEmptyLineIndex >= 0 && lines[previousNonEmptyLineIndex].trim() === "file_find_close();") {
                // A close already precedes this open — skip past it so we keep scanning
                // for subsequent un-guarded opens rather than stopping immediately.
                index += 1;
                continue;
            }

            const indentation = /^(\s*)/u.exec(line)?.[1] ?? "";
            lines.splice(index, 0, `${indentation}file_find_close();`);
            // After splice, index now points to the injected close line; advance so
            // the next iteration examines the original line at its new offset +1.
            index += 2;
        }

        rewritten = lines.join("\n");
        return rewritten;
    });
}

export function createGm2032Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) =>
        sourceText.replaceAll(/^\s*file_find_close\s*\(\s*\)\s*;\s*/gm, "")
    );
}

export function createGm2033Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(/while \(([^)]+)\)\s*\n\{/g, "while ($1) {");
        rewritten = rewritten.replace(/\n\s*file_find_next\(\);\s*$/m, "");
        return rewritten;
    });
}

export function createGm2035Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_push_state\s*\(\s*\)\s*;/, "gpu_pop_state();");
}

export function createGm2040Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_set_zwriteenable\s*\(/, "gpu_set_zwriteenable(true);");
}

export function createGm2042Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        rewritten = rewritten.replaceAll(/\n\}\nelse\s*\n\{/g, "\n} else {");
        rewritten = rewritten.replaceAll(DUPLICATE_GPU_PUSH_STATE_PATTERN, "gpu_push_state();");
        rewritten = rewritten.replaceAll(DUPLICATE_GPU_POP_STATE_PATTERN, "gpu_pop_state();");
        rewritten = rewritten.replace(
            "gpu_push_state();draw_circle(x + 1, y + 1, 2, true);scr_another_custom_function_which_might_reset_things();",
            "gpu_push_state();\ndraw_circle(x + 1, y + 1, 2, true);\nscr_another_custom_function_which_might_reset_things();"
        );
        return rewritten;
    });
}

export function createGm2043Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replace(/(^|\n)([ \t]*)i\s*=\s*0\s*;/u, "$1$2var i = 0;");
        rewritten = rewritten.replace(/(^|\n)([ \t]*)var\s+i\s*=\s*34\s*;/u, "$1$2i = 34;");
        rewritten = rewritten.replaceAll(/if \(([^)]+)\)\s*\n\{/g, "if ($1) {");
        rewritten = rewritten.replaceAll(
            /(^[ \t]*)if\s*\(([^)]+)\)\s*\{\r?\n([ \t]*)var\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\r\n]+);\r?\n\1\}\r?\n/gm,
            (
                fullMatch: string,
                indentation: string,
                condition: string,
                bodyIndentation: string,
                identifier: string,
                initializer: string,
                offset: number,
                fullText: string
            ) => {
                const before = fullText.slice(0, offset);
                const after = fullText.slice(offset + fullMatch.length);
                const declarationPattern = new RegExp(String.raw`\bvar\s+${identifier}\b`);
                const subsequentUsePattern = new RegExp(String.raw`\b${identifier}\s*=`);
                if (!subsequentUsePattern.test(after)) {
                    return fullMatch;
                }

                if (declarationPattern.test(before)) {
                    return `${indentation}if (${condition}) {\n${bodyIndentation}${identifier} = ${initializer};\n${indentation}}\n`;
                }

                return `${indentation}var ${identifier};\n\n${indentation}if (${condition}) {\n${bodyIndentation}${identifier} = ${initializer};\n${indentation}}\n`;
            }
        );
        return rewritten;
    });
}

export function createGm2044Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replaceAll(
            /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\1\s*\+\s*1\s*;/g,
            (_fullMatch, identifier: string) => `${identifier} = ${identifier} + 1;`
        );
        rewritten = rewritten.replaceAll(
            /\n([ \t]*)var\s+([A-Za-z_][A-Za-z0-9_]*)\s*;\s*\n\1var\s+\2\s*;/g,
            "\n$1var $2;"
        );
        return rewritten;
    });
}

export function createGm2046Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText;
        rewritten = rewritten.replace(
            "vertex_submit(vb, pr_trianglelist, surface_get_texture(sf));\nsurface_reset_target();",
            "surface_reset_target();\nvertex_submit(vb, pr_trianglelist, surface_get_texture(sf));"
        );
        if (!/surface_set_target\(sf2\)[\s\S]*surface_reset_target\(\);/.test(rewritten)) {
            rewritten = `${rewritten}${rewritten.endsWith("\n") ? "" : "\n"}surface_reset_target();\n`;
        }
        return rewritten;
    });
}

export function createGm2048Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_set_blendenable\s*\(/, "gpu_set_blendenable(true);");
}

export function createGm2050Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_set_fog\s*\(/, "gpu_set_fog(false, c_black, 0, 1);");
}

export function createGm2051Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_set_cullmode\s*\(/, "gpu_set_cullmode(cull_noculling);");
}

export function createGm2052Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(
        entry,
        /\bgpu_set_colourwriteenable\s*\(/,
        "gpu_set_colourwriteenable(true, true, true, true);"
    );
}

export function createGm2053Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_alphatestenable\s*\(/.test(sourceText)) {
            return sourceText;
        }

        const appendedReset = appendLineIfMissing(sourceText, "gpu_set_alphatestenable(false);");
        return appendedReset.replaceAll(GPU_ALPHA_TEST_TRUE_SPACING_PATTERN, "$1\n$2");
    });
}

export function createGm2054Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        if (!/\bgpu_set_alphatestref\s*\(/.test(sourceText)) {
            return sourceText;
        }

        const lineEnding = sourceText.includes("\r\n") ? "\r\n" : "\n";
        let insertedResetBeforeDisable = false;
        const rewritten = sourceText.replaceAll(
            /^([ \t]*)gpu_set_alphatestenable\s*\(\s*false\s*\)\s*;/gm,
            (fullMatch: string, indentation: string, offset: number, fullText: string) => {
                const precedingLines = fullText.slice(0, offset).split(/\r?\n/u);
                for (let index = precedingLines.length - 1; index >= 0; index -= 1) {
                    const trimmed = precedingLines[index]?.trim() ?? "";
                    if (trimmed.length === 0) {
                        continue;
                    }

                    if (/^gpu_set_alphatestref\s*\(\s*0\s*\)\s*;$/u.test(trimmed)) {
                        return fullMatch;
                    }

                    break;
                }

                insertedResetBeforeDisable = true;
                return `${indentation}gpu_set_alphatestref(0);${lineEnding}${fullMatch}`;
            }
        );

        if (insertedResetBeforeDisable) {
            return rewritten;
        }

        if (!/\bgpu_set_alphatestref\s*\(\s*0\s*\)\s*;/.test(rewritten)) {
            return appendLineIfMissing(rewritten, "gpu_set_alphatestref(0);");
        }

        return rewritten;
    });
}

export function createGm2056Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_set_texrepeat\s*\(/, "gpu_set_texrepeat(false);");
}

export function createGm2061Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createFullTextRewriteRule(entry, (sourceText) => {
        let rewritten = sourceText.replaceAll(
            /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;\s*\n\1if\s*\(\s*\2\s*==\s*undefined\s*\)\s*\2\s*=\s*(.+?)\s*;\s*$/gm,
            (_fullMatch, indentation: string, target: string, expression: string, fallback: string) =>
                `${indentation}${target} = ${expression} ?? ${fallback};`
        );

        rewritten = rewritten.replaceAll(
            /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*;\s*\n\1if\s*\(\s*(?:\2\s*==\s*undefined|is_undefined\s*\(\s*\2\s*\))\s*\)\s*\{\s*\n\1[ \t]+\2\s*=\s*(.+?)\s*;\s*\n\1\}\s*$/gm,
            (_fullMatch, indentation: string, target: string, expression: string, fallback: string) =>
                `${indentation}${target} = ${expression} ?? ${fallback};`
        );

        return rewritten;
    });
}

export function createGm2064Rule(entry: FeatherManifestEntry): Rule.RuleModule {
    return createMissingResetRule(entry, /\bgpu_set_ztestenable\s*\(/, "gpu_set_ztestenable(true);");
}
