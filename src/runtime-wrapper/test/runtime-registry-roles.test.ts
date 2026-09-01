import assert from "node:assert";
import { describe, it } from "node:test";

import { validateBatchPatchDependencies, validatePatchDependencies } from "../src/browser/runtime/patch-utils.js";
import type {
    ClosureCollection,
    EventCollection,
    Patch,
    PatchDependencyRegistry,
    ResourceCollection,
    RuntimeRegistry,
    ScriptCollection,
    VersionedRegistry
} from "../src/browser/runtime/types.js";

/**
 * Structural contract tests for the role interfaces carved out of the
 * historical `RuntimeRegistry` aggregate.
 *
 * The pre-split `RuntimeRegistry` mixed versioning, script collection,
 * event collection, closure collection, and resource collection into a
 * single object, forcing every consumer (including dependency validators
 * that only consult scripts/events/closures) to depend on every member.
 *
 * After the Interface Segregation refactor these tests verify that:
 *   - Each role interface can be satisfied by an object that *only* declares
 *     the role's members, proving the contracts are genuinely narrower.
 *   - The composite `RuntimeRegistry` still satisfies every role interface
 *     (i.e. it continues to work wherever a role was expected).
 *   - Dependency validators (which now declare `PatchDependencyRegistry`)
 *     accept role-only views, not just the full registry.
 */

function createScriptOnly(): ScriptCollection {
    return {
        scripts: {
            "script:alpha": () => 1
        }
    };
}

function createEventOnly(): EventCollection {
    return {
        events: {
            "event:obj_player:Step_0": () => undefined
        }
    };
}

function createClosureOnly(): ClosureCollection {
    return {
        closures: {
            "closure:cb1": () => 42
        }
    };
}

function createResourceOnly(): ResourceCollection {
    return {
        resources: {
            "resource:room_start": {
                kind: "resource",
                id: "resource:room_start",
                resourceType: "GMRoom",
                resourceName: "rm_start",
                layerUpdates: []
            }
        }
    };
}

function createVersionedOnly(): VersionedRegistry {
    return { version: 7 };
}

function createComposite(): RuntimeRegistry {
    return {
        version: 1,
        scripts: { "script:base": () => 10 },
        events: {},
        closures: {},
        resources: {}
    };
}

void describe("RuntimeRegistry role interfaces", () => {
    void it("ScriptCollection is satisfied by an object declaring only scripts", () => {
        const scriptsOnly: ScriptCollection = createScriptOnly();
        assert.strictEqual(Object.keys(scriptsOnly.scripts).length, 1);
        assert.ok("script:alpha" in scriptsOnly.scripts);
    });

    void it("EventCollection is satisfied by an object declaring only events", () => {
        const eventsOnly: EventCollection = createEventOnly();
        assert.strictEqual(Object.keys(eventsOnly.events).length, 1);
        assert.ok("event:obj_player:Step_0" in eventsOnly.events);
    });

    void it("ClosureCollection is satisfied by an object declaring only closures", () => {
        const closuresOnly: ClosureCollection = createClosureOnly();
        assert.strictEqual(Object.keys(closuresOnly.closures).length, 1);
        assert.ok("closure:cb1" in closuresOnly.closures);
    });

    void it("ResourceCollection is satisfied by an object declaring only resources", () => {
        const resourcesOnly: ResourceCollection = createResourceOnly();
        assert.ok(resourcesOnly.resources);
        const resourceKeys = resourcesOnly.resources ? Object.keys(resourcesOnly.resources) : [];
        assert.ok(resourceKeys.includes("resource:room_start"));
    });

    void it("VersionedRegistry is satisfied by an object declaring only a version", () => {
        const versionedOnly: VersionedRegistry = createVersionedOnly();
        assert.strictEqual(versionedOnly.version, 7);
    });

    void it("composite RuntimeRegistry satisfies every role interface", () => {
        const registry: RuntimeRegistry = createComposite();
        const scripts: ScriptCollection = registry;
        const events: EventCollection = registry;
        const closures: ClosureCollection = registry;
        const resources: ResourceCollection = registry;
        const versioned: VersionedRegistry = registry;
        const dependencyView: PatchDependencyRegistry = registry;

        assert.ok(scripts.scripts);
        assert.ok(events.events);
        assert.ok(closures.closures);
        assert.ok(resources.resources);
        assert.strictEqual(versioned.version, 1);
        assert.ok(dependencyView.scripts && dependencyView.events && dependencyView.closures);
    });

    void it("PatchDependencyRegistry accepts a script-only view when event/closure collections are irrelevant to the validator", () => {
        // A consumer wiring a custom dependency registry can pass just the
        // collections it knows about. The validator only inspects scripts,
        // events, and closures; supplying scripts alone is therefore a valid
        // narrow contract.
        const scriptsOnly: ScriptCollection = { scripts: { "script:base": () => 1 } };
        const dependencyView: PatchDependencyRegistry = {
            ...scriptsOnly,
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return script_base();",
            metadata: { dependencies: ["script:base"] }
        };

        const result = validatePatchDependencies(patch, dependencyView);
        assert.strictEqual(result.satisfied, true);
        assert.deepStrictEqual(result.missingDependencies, []);
    });

    void it("validatePatchDependencies still detects missing dependencies on the narrow contract", () => {
        const dependencyView: PatchDependencyRegistry = {
            scripts: {},
            events: {},
            closures: {}
        };

        const patch: Patch = {
            kind: "script",
            id: "script:dependent",
            js_body: "return script_base();",
            metadata: { dependencies: ["script:missing"] }
        };

        const result = validatePatchDependencies(patch, dependencyView);
        assert.strictEqual(result.satisfied, false);
        assert.deepStrictEqual(result.missingDependencies, ["script:missing"]);
    });

    void it("validateBatchPatchDependencies accepts the narrow PatchDependencyRegistry", () => {
        const dependencyView: PatchDependencyRegistry = {
            scripts: { "script:base": () => 1 },
            events: {},
            closures: {}
        };

        const patches: ReadonlyArray<Patch> = [
            {
                kind: "script",
                id: "script:base",
                js_body: "return 1;"
            },
            {
                kind: "script",
                id: "script:dependent",
                js_body: "return script_base();",
                metadata: { dependencies: ["script:base"] }
            }
        ];

        const result = validateBatchPatchDependencies(patches, dependencyView);
        assert.deepStrictEqual(result, { satisfied: true });
    });
});
