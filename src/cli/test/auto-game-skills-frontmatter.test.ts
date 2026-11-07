import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSkillFrontmatter } from "../src/modules/auto-game-skills/frontmatter.js";

void describe("parseSkillFrontmatter", () => {
    void it("extracts a flat `key: value` Agent Skills frontmatter block", () => {
        const source = [
            "---",
            "name: cli-command-architecture",
            "description: Use this skill when working on CLI commands.",
            "---",
            "",
            "# Body"
        ].join("\n");

        const result = parseSkillFrontmatter(source);
        assert.ok(result, "expected a parsed frontmatter block");
        assert.deepEqual(result?.data, {
            name: "cli-command-architecture",
            description: "Use this skill when working on CLI commands."
        });
    });

    void it("returns an empty `data` object when the document does not start with a frontmatter delimiter", () => {
        const source = "name: missing-open-delimiter\ndescription: nope\n";
        const result = parseSkillFrontmatter(source);
        assert.deepEqual(result, { data: {} });
    });

    void it("returns null when the closing delimiter is missing", () => {
        const source = "---\nname: dangling\ndescription: forever\n";
        assert.equal(parseSkillFrontmatter(source), null);
    });

    void it("returns an empty `data` object when the document is empty", () => {
        assert.deepEqual(parseSkillFrontmatter(""), { data: {} });
    });

    void it("treats bare `key:` lines as `null` values", () => {
        const source = ["---", "name:", "description: present", "---"].join("\n");
        const result = parseSkillFrontmatter(source);
        assert.ok(result, "expected a parsed frontmatter block");
        assert.equal(result?.data.name, null);
        assert.equal(result?.data.description, "present");
    });

    void it("coerces boolean and null literals", () => {
        const source = ["---", "name: sample", "draft: true", "archived: false", "owner: ~", "tag: null", "---"].join(
            "\n"
        );

        const result = parseSkillFrontmatter(source);
        assert.ok(result);
        assert.equal(result?.data.draft, true);
        assert.equal(result?.data.archived, false);
        assert.equal(result?.data.owner, null);
        assert.equal(result?.data.tag, null);
    });

    void it("strips a single layer of matching double or single quotes", () => {
        const source = ["---", `name: "quoted-name"`, `description: 'quoted description'`, "---"].join("\n");

        const result = parseSkillFrontmatter(source);
        assert.ok(result);
        assert.equal(result?.data.name, "quoted-name");
        assert.equal(result?.data.description, "quoted description");
    });

    void it("ignores blank lines inside the frontmatter block", () => {
        const source = ["---", "name: spaced", "", "description: with a blank line above", "---"].join("\n");

        const result = parseSkillFrontmatter(source);
        assert.ok(result);
        assert.deepEqual(result?.data, {
            name: "spaced",
            description: "with a blank line above"
        });
    });

    void it("accepts a leading UTF-8 BOM before the opening delimiter", () => {
        const source = `\uFEFF---\nname: bom-skill\ndescription: with a BOM\n---\n`;
        const result = parseSkillFrontmatter(source);
        assert.ok(result);
        assert.equal(result?.data.name, "bom-skill");
        assert.equal(result?.data.description, "with a BOM");
    });

    void it("normalises CRLF line endings", () => {
        const source = "---\r\nname: crlf-skill\r\ndescription: windows line endings\r\n---\r\n";
        const result = parseSkillFrontmatter(source);
        assert.ok(result);
        assert.equal(result?.data.name, "crlf-skill");
        assert.equal(result?.data.description, "windows line endings");
    });

    void it("returns null when the frontmatter contains a non-flat shape", () => {
        const source = ["---", "name: [", "description: broken", "---"].join("\n");
        assert.equal(parseSkillFrontmatter(source), null);
    });

    void it("returns null when the block has no keys", () => {
        const source = ["---", "", "---"].join("\n");
        assert.equal(parseSkillFrontmatter(source), null);
    });
});
