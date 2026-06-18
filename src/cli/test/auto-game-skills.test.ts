import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSkillsCommand, runSkillsInit } from "../src/commands/skills.js";
import {
    discoverAutoGameProjectSkills,
    discoverPackagedAutoGameSkillNames,
    initializeAutoGameProjectSkills,
    setAutoGameProjectSkillEnabled
} from "../src/modules/auto-game-skills/index.js";

async function createGameProjectFixture(): Promise<Readonly<{ cleanup: () => Promise<void>; projectRoot: string }>> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-auto-game-skills-"));
    await writeFile(path.join(projectRoot, "Fixture.yyp"), '{"resourceType":"GMProject"}\n', "utf8");
    return Object.freeze({
        cleanup: () => rm(projectRoot, { force: true, recursive: true }),
        projectRoot
    });
}

async function writeSkill(projectRoot: string, directoryName: string, contents: string): Promise<void> {
    const skillDirectory = path.join(projectRoot, ".agents", "skills", directoryName);
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "SKILL.md"), contents, "utf8");
}

void test("packaged Auto-Game skills are discovered from the collection directory in deterministic order", async () => {
    const packagedSkillNames = await discoverPackagedAutoGameSkillNames();
    assert.ok(packagedSkillNames.length > 0);
    assert.deepEqual(packagedSkillNames, [...packagedSkillNames].sort());
    assert.equal(new Set(packagedSkillNames).size, packagedSkillNames.length);
});

void test("Auto-Game initialization is inventory-independent, idempotent, and preserves project skills", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const packagedSkillNames = await discoverPackagedAutoGameSkillNames();
        const preservedSkillName = packagedSkillNames.at(0);
        assert.ok(preservedSkillName);
        const customContents = `---\nname: ${preservedSkillName}\ndescription: Project-specific guidance.\n---\n\n# Custom\n`;
        await writeSkill(fixture.projectRoot, preservedSkillName, customContents);

        const first = await initializeAutoGameProjectSkills(fixture.projectRoot);
        assert.deepEqual(
            first.copied,
            packagedSkillNames.filter((name) => name !== preservedSkillName)
        );
        assert.deepEqual(first.skipped, [preservedSkillName]);
        assert.equal(
            await readFile(path.join(fixture.projectRoot, ".agents", "skills", preservedSkillName, "SKILL.md"), "utf8"),
            customContents
        );

        const second = await initializeAutoGameProjectSkills(fixture.projectRoot);
        assert.deepEqual(second.copied, []);
        assert.deepEqual(second.skipped, packagedSkillNames);
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game discovery reads only the supplied GameMaker project skill root", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(
            fixture.projectRoot,
            "game-design",
            "---\nname: game-design\ndescription: Design this game.\n---\n\n# Instructions\n"
        );
        const skills = await discoverAutoGameProjectSkills(fixture.projectRoot, {});
        assert.deepEqual(
            skills.map((skill) => skill.name),
            ["game-design"]
        );
        assert.equal(
            skills.some((skill) => skill.name === "cli-command-architecture"),
            false
        );
        assert.equal(skills[0]?.enabled, true);
        assert.equal(skills[0]?.sourcePath, ".agents/skills/game-design/SKILL.md");
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game discovery does not implement custom Agent Skills conformance validation", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(fixture.projectRoot, "broken-skill", "# Missing frontmatter\n");
        const skills = await discoverAutoGameProjectSkills(fixture.projectRoot, {});
        assert.equal(skills[0]?.status, "available");
        assert.equal(skills[0]?.enabled, true);
        assert.equal(skills[0]?.diagnostic, null);
        assert.match(skills[0]?.description ?? "", /No description/u);
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game discovery keeps unreadable skill metadata visible, enabled, and toggleable", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(fixture.projectRoot, "unreadable-skill", "---\nname: [\n---\n");
        const skills = await discoverAutoGameProjectSkills(fixture.projectRoot, {});
        assert.equal(skills[0]?.status, "unreadable");
        assert.equal(skills[0]?.enabled, true);
        assert.match(skills[0]?.diagnostic ?? "", /Could not parse/u);

        await setAutoGameProjectSkillEnabled(fixture.projectRoot, "unreadable-skill", false);
        const config = JSON.parse(await readFile(path.join(fixture.projectRoot, "gmloop.json"), "utf8")) as {
            autoGame: { disabledSkills: Array<string> };
        };
        const disabledSkills = await discoverAutoGameProjectSkills(fixture.projectRoot, config);
        assert.equal(disabledSkills[0]?.enabled, false);
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game skill toggles persist sorted disabled exceptions and preserve unrelated config", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await writeSkill(
            fixture.projectRoot,
            "game-design",
            "---\nname: game-design\ndescription: Design this game.\n---\n\n# Instructions\n"
        );
        await writeFile(
            path.join(fixture.projectRoot, "gmloop.json"),
            `${JSON.stringify({ autoGame: { mode: "local" }, runtime: { enabled: true } }, null, 2)}\n`,
            "utf8"
        );

        await setAutoGameProjectSkillEnabled(fixture.projectRoot, "game-design", false);
        const disabledConfig = JSON.parse(await readFile(path.join(fixture.projectRoot, "gmloop.json"), "utf8")) as {
            autoGame: { disabledSkills: Array<string>; mode: string };
            runtime: { enabled: boolean };
        };
        assert.deepEqual(disabledConfig.autoGame.disabledSkills, ["game-design"]);
        assert.equal(disabledConfig.autoGame.mode, "local");
        assert.equal(disabledConfig.runtime.enabled, true);
        const disabledSkills = await discoverAutoGameProjectSkills(fixture.projectRoot, disabledConfig);
        assert.equal(disabledSkills[0]?.enabled, false);

        await setAutoGameProjectSkillEnabled(fixture.projectRoot, "game-design", true);
        const enabledConfig = JSON.parse(await readFile(path.join(fixture.projectRoot, "gmloop.json"), "utf8")) as {
            autoGame: { disabledSkills: Array<string> };
        };
        assert.deepEqual(enabledConfig.autoGame.disabledSkills, []);
    } finally {
        await fixture.cleanup();
    }
});

void test("Auto-Game skill operations reject directories without a root-level yyp", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gmloop-not-game-project-"));
    try {
        await assert.rejects(() => initializeAutoGameProjectSkills(directory), /containing a \.yyp file/u);
        await assert.rejects(() => discoverAutoGameProjectSkills(directory, {}), /containing a \.yyp file/u);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

void test("skills init exposes the standard project path option", () => {
    const command = createSkillsCommand();
    const init = command.commands.find((candidate) => candidate.name() === "init");
    assert.ok(init);
    assert.equal(
        init.options.some((option) => option.long === "--path"),
        true
    );
});

void test("skills init accepts an explicit yyp path and reports deterministic results", async (context) => {
    const fixture = await createGameProjectFixture();
    const output = new Array<string>();
    context.mock.method(console, "log", (value: string) => output.push(value));
    try {
        const packagedSkillNames = await discoverPackagedAutoGameSkillNames();
        await runSkillsInit({ path: path.join(fixture.projectRoot, "Fixture.yyp") });
        assert.equal(output.length, 1);
        const payload = JSON.parse(output[0] ?? "") as {
            command: string;
            payload: { copied: Array<string>; skipped: Array<string> };
            projectRoot: string;
        };
        assert.equal(payload.command, "skills init");
        assert.equal(payload.projectRoot, fixture.projectRoot);
        assert.deepEqual(payload.payload.copied, packagedSkillNames);
        assert.deepEqual(payload.payload.skipped, []);
    } finally {
        await fixture.cleanup();
    }
});
