import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { __graphIndexBuilderTest__, searchGraphIndex } from "../src/graph-index/builder.js";
import { openGraphIndexDatabase } from "../src/graph-index/database.js";

void test("resolveScipSymbol uses stable identifier keys for enums and enum members", () => {
    assert.equal(
        __graphIndexBuilderTest__.resolveScipSymbol("enum", "State", {
            identifierId: "enum:scripts/player/player.gml::3::10",
            key: "scripts/player/player.gml::3::10",
            name: "State"
        }),
        "gml/enum/enum:scripts/player/player.gml::3::10"
    );

    assert.equal(
        __graphIndexBuilderTest__.resolveScipSymbol("enum_member", "Idle", {
            identifierId: "enum-member:scripts/player/player.gml::4::20",
            key: "scripts/player/player.gml::4::20",
            name: "Idle"
        }),
        "gml/enum-member/enum-member:scripts/player/player.gml::4::20"
    );
});

void test("resolveScipSymbol preserves legacy symbol shapes for other identifier kinds", () => {
    assert.equal(
        __graphIndexBuilderTest__.resolveScipSymbol("macro", "MAX_SPEED", {
            name: "MAX_SPEED"
        }),
        "gml/macro/MAX_SPEED"
    );

    assert.equal(
        __graphIndexBuilderTest__.resolveScipSymbol("function", "step_player", {
            key: "scripts/player/player.gml::10:9:100",
            name: "step_player"
        }),
        "gml/function/scripts/player/player.gml::10:9:100"
    );
});

void test("createSafeFtsQuery strips unsafe punctuation and quotes remaining tokens", () => {
    assert.equal(
        __graphIndexBuilderTest__.createSafeFtsQuery('  VisibleState.Active() + "Ready"  '),
        '"VisibleState" OR "Active" OR "Ready"'
    );
    assert.equal(__graphIndexBuilderTest__.createSafeFtsQuery("   !!!   "), "");
});

void test("searchGraphIndex returns the single script node before contained same-named functions", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "graph-index-search-ranking-"));
    const databasePath = path.join(tempRoot, "graph-index.sqlite");
    const database = openGraphIndexDatabase(databasePath);

    try {
        database.exec("BEGIN");

        database
            .prepare(
                "INSERT INTO graphs(id, scope, root_path, manifest_path, last_indexed_at, schema_version) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .run("project", "project", tempRoot, null, "2026-01-01T00:00:00.000Z", 2);
        database
            .prepare(
                "INSERT INTO index_state(graph_id, file_count, node_count, edge_count, embedding_model, build_duration_ms) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .run("project", 1, 2, 1, "disabled", 1);

        database
            .prepare(
                `
                    INSERT INTO nodes(
                        id, graph_id, kind, name, display_name, scip_symbol, relative_path, resource_path, scope_id,
                        line_start, line_end, summary, snippet, content_hash
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
            )
            .run(
                "project::resource::scripts/visible_symbols/visible_symbols.yy",
                "project",
                "script",
                "visible_symbols",
                "visible_symbols",
                "gml/script/visible_symbols",
                "scripts/visible_symbols/visible_symbols.gml",
                "scripts/visible_symbols/visible_symbols.yy",
                "scope:script:visible_symbols",
                1,
                10,
                "Script symbol",
                "",
                "hash-script"
            );
        database
            .prepare(
                `
                    INSERT INTO nodes(
                        id, graph_id, kind, name, display_name, scip_symbol, relative_path, resource_path, scope_id,
                        line_start, line_end, summary, snippet, content_hash
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
            )
            .run(
                "project::gml/function/function:scripts/visible_symbols/visible_symbols.gml::1:9:9",
                "project",
                "function",
                "visible_symbols",
                "visible_symbols",
                "gml/function/function:scripts/visible_symbols/visible_symbols.gml::1:9:9",
                "scripts/visible_symbols/visible_symbols.gml",
                null,
                "scope:function:visible_symbols",
                1,
                1,
                "Function symbol",
                "",
                "hash-function"
            );

        database
            .prepare("INSERT INTO node_fts(id, name, display_name, summary, content) VALUES (?, ?, ?, ?, ?)")
            .run(
                "project::resource::scripts/visible_symbols/visible_symbols.yy",
                "visible_symbols",
                "visible_symbols",
                "Script symbol",
                "Script symbol"
            );
        database
            .prepare("INSERT INTO node_fts(id, name, display_name, summary, content) VALUES (?, ?, ?, ?, ?)")
            .run(
                "project::gml/function/function:scripts/visible_symbols/visible_symbols.gml::1:9:9",
                "visible_symbols",
                "visible_symbols",
                "Function symbol",
                "Function symbol"
            );

        database
            .prepare("INSERT INTO edges(from_id, to_id, type, ordinal) VALUES (?, ?, ?, ?)")
            .run(
                "project::resource::scripts/visible_symbols/visible_symbols.yy",
                "project::gml/function/function:scripts/visible_symbols/visible_symbols.gml::1:9:9",
                "defines",
                0
            );

        database.exec("COMMIT");

        const search = searchGraphIndex({
            databasePath,
            projectConfig: {
                graph: {
                    embeddings: {
                        enabled: false
                    }
                }
            },
            projectRoot: tempRoot,
            query: "visible_symbols"
        });

        assert.equal(search.results[0]?.id, "project::resource::scripts/visible_symbols/visible_symbols.yy");
        assert.equal(
            search.results[1]?.id,
            "project::gml/function/function:scripts/visible_symbols/visible_symbols.gml::1:9:9"
        );
    } finally {
        database.close();
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
});
