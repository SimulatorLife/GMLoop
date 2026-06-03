import {
    areNumbersApproximatelyEqual,
    isErrorLike,
    isNonEmptyArray,
    isNonEmptyString,
    readCxcDxStore,
    readRuntimeObjectPool
} from "../support/index.js";
import { resolveBuiltinConstants } from "./builtin-constants.js";
import { isRuntimeBuiltinFunction, resolveRuntimeBuiltinFunctions } from "./builtin-functions.js";
import { getPatchKindMetadata, isSupportedPatchKind, type RegistryCollectionKey } from "./patch-kind.js";
import type {
    ApplyPatchResult,
    BasePatch,
    ClosurePatch,
    EventPatch,
    Patch,
    PatchSnapshot,
    RuntimeFunction,
    RuntimeRegistry,
    RuntimeRegistryOverrides,
    ScriptPatch,
    ShadowTestResult
} from "./types.js";

type RuntimeBindingGlobals = {
    JSON_game?: {
        ScriptNames?: Array<string>;
        Scripts?: Array<RuntimeFunction>;
        GMObjects?: Array<Record<string, unknown>>;
    };
    _a1?: {
        _52?: Array<Record<string, unknown>>;
        _98?: Array<string>;
        _a8?: Array<RuntimeFunction>;
    };
    g_pBuiltIn?: Record<string, unknown>;
    _g8?: Record<string, unknown>;
    _cx?: {
        _dx?: Record<string, unknown>;
    };
    g_RunRoom?: {
        m_Active?: {
            pool?: Array<unknown>;
        };
    };
    g_pObjectManager?: {
        objnamelist?: Record<string, unknown>;
        objidlist?: Array<unknown>;
    };
};

type EventMapping = {
    standard: string;
    minified: string;
};

type ObjectEventPrefixMapping = {
    prefixes: ReadonlyArray<string>;
    eventKey: string;
    minifiedEventKey: string;
    minifiedFunctionOrdinal: number | null;
};

type RuntimeGameData = Readonly<{
    gmObjects: Array<Record<string, unknown>> | undefined;
    scriptNames: Array<string> | undefined;
    scripts: Array<RuntimeFunction> | undefined;
}>;

type InstanceStore = Array<unknown> | Record<string, unknown>;

type RuntimeBindingApplication = Readonly<{
    gmObjects: Array<Record<string, unknown>> | undefined;
    instanceStore: InstanceStore | undefined;
    objectName: string | null;
    objectRuntime: { objectName: string; eventName: string } | null;
}>;

const EVENT_MAPPINGS: ReadonlyMap<string, EventMapping> = new Map([
    ["PreCreateEvent", { standard: "EVENT_PRE_CREATE", minified: "_qI" }],
    ["CreateEvent", { standard: "EVENT_CREATE", minified: "_rI" }],
    ["DestroyEvent", { standard: "EVENT_DESTROY", minified: "_tI" }],
    ["CleanUpEvent", { standard: "EVENT_CLEAN_UP", minified: "_aI" }],
    ["StepBeginEvent", { standard: "EVENT_STEP_BEGIN", minified: "_sB2" }],
    ["StepNormalEvent", { standard: "EVENT_STEP_NORMAL", minified: "_uB2" }],
    ["StepEndEvent", { standard: "EVENT_STEP_END", minified: "_wB2" }],
    ["DrawEvent", { standard: "EVENT_DRAW", minified: "_6E2" }],
    ["DrawGUI", { standard: "EVENT_DRAW_GUI", minified: "_2G2" }],
    ["DrawEventBegin", { standard: "EVENT_DRAW_BEGIN", minified: "_4G2" }],
    ["DrawEventEnd", { standard: "EVENT_DRAW_END", minified: "_5G2" }],
    ["DrawGUIBegin", { standard: "EVENT_DRAW_GUI_BEGIN", minified: "_6G2" }],
    ["DrawGUIEnd", { standard: "EVENT_DRAW_GUI_END", minified: "_7G2" }]
]);

const OBJECT_EVENT_PREFIX_MAPPINGS: ReadonlyArray<ObjectEventPrefixMapping> = Object.freeze([
    { prefixes: ["PreCreate"], eventKey: "PreCreateEvent", minifiedEventKey: "_42", minifiedFunctionOrdinal: null },
    { prefixes: ["Create"], eventKey: "CreateEvent", minifiedEventKey: "_62", minifiedFunctionOrdinal: 0 },
    { prefixes: ["CleanUp"], eventKey: "CleanUpEvent", minifiedEventKey: "_f2", minifiedFunctionOrdinal: null },
    { prefixes: ["Destroy"], eventKey: "DestroyEvent", minifiedEventKey: "_e2", minifiedFunctionOrdinal: null },
    { prefixes: ["StepBegin"], eventKey: "StepBeginEvent", minifiedEventKey: "_72", minifiedFunctionOrdinal: null },
    { prefixes: ["StepEnd"], eventKey: "StepEndEvent", minifiedEventKey: "_92", minifiedFunctionOrdinal: null },
    { prefixes: ["Step"], eventKey: "StepNormalEvent", minifiedEventKey: "_82", minifiedFunctionOrdinal: 1 },
    { prefixes: ["DrawGUIBegin"], eventKey: "DrawGUIBegin", minifiedEventKey: "_d2", minifiedFunctionOrdinal: null },
    { prefixes: ["DrawGUIEnd"], eventKey: "DrawGUIEnd", minifiedEventKey: "_e2", minifiedFunctionOrdinal: null },
    { prefixes: ["DrawGUI"], eventKey: "DrawGUI", minifiedEventKey: "_c2", minifiedFunctionOrdinal: null },
    {
        prefixes: ["DrawEventBegin", "DrawBegin"],
        eventKey: "DrawEventBegin",
        minifiedEventKey: "_92",
        minifiedFunctionOrdinal: null
    },
    {
        prefixes: ["DrawEventEnd", "DrawEnd"],
        eventKey: "DrawEventEnd",
        minifiedEventKey: "_c2",
        minifiedFunctionOrdinal: null
    },
    { prefixes: ["Draw"], eventKey: "DrawEvent", minifiedEventKey: "_a2", minifiedFunctionOrdinal: 2 }
]);

// Cached reverse-lookup from script name → index in JSON_game.ScriptNames.
// The GameMaker HTML5 runtime populates ScriptNames exactly once at startup and
// never mutates it after that, so caching on the array reference is safe.
// This avoids two O(n) linear scans (Array#includes + Array#indexOf) per
// hot-reload cycle, which can be significant for games with hundreds of scripts.
let _scriptNamesRef: Array<string> | null = null;
let _scriptNameIndex: Map<string, number> | null = null;

/**
 * Returns (or builds) a name→index Map for the given scriptNames array.
 * The result is memoised by the array reference: if the caller passes the same
 * array on repeated calls (the normal case) the Map is reused without allocation.
 * A new Map is built only when the reference changes (e.g. after a full reload).
 */
function resolveScriptNameIndex(scriptNames: Array<string>): ReadonlyMap<string, number> {
    if (_scriptNamesRef === scriptNames && _scriptNameIndex !== null) {
        return _scriptNameIndex;
    }

    _scriptNamesRef = scriptNames;
    _scriptNameIndex = new Map(scriptNames.map((name, index) => [name, index]));
    return _scriptNameIndex;
}

function discoverMinifiedInstancePool(globalScope: Record<string, unknown>): InstanceStore | undefined {
    for (const propertyName of Object.getOwnPropertyNames(globalScope)) {
        try {
            const candidate = globalScope[propertyName];
            if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
                for (const value of Object.values(candidate)) {
                    if (value && typeof value === "object") {
                        const keys = Object.keys(value);
                        if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
                            const firstVal = value[keys[0]];
                            if (
                                firstVal &&
                                typeof firstVal === "object" &&
                                !("nodeType" in firstVal) &&
                                (firstVal.__type === "[instance]" ||
                                    ("id" in firstVal && "x" in firstVal && "y" in firstVal))
                             && keys.some((k) => Number(k) >= 100_000)) {
                                    return value as InstanceStore;
                                }
                        }
                    }
                }
            }
        } catch {}
    }
    return undefined;
}

function resolveInstanceStore(globalScope: RuntimeBindingGlobals & Record<string, unknown>): InstanceStore | undefined {
    // Prefer the _cx._dx store when available.
    const cxcDx = readCxcDxStore(globalScope);
    if (cxcDx) {
        return cxcDx;
    }

    // Fall back to the runtime object pool from g_RunRoom.m_Active.pool.
    const pool = readRuntimeObjectPool(globalScope);
    if (pool !== undefined) {
        return pool;
    }

    const minifiedPool = discoverMinifiedInstancePool(globalScope);
    if (minifiedPool !== undefined) {
        return minifiedPool;
    }

    for (const propertyName of Object.keys(globalScope)) {
        const candidate = readGlobalProperty(globalScope, propertyName);
        if (!isRecord(candidate)) {
            continue;
        }

        for (const propertyValue of Object.values(candidate)) {
            if (isLikelyInstanceVariableArray(propertyValue)) {
                return propertyValue;
            }
        }
    }

    for (const propertyName of Object.keys(globalScope)) {
        const candidate = readGlobalProperty(globalScope, propertyName);
        if (!isRecord(candidate)) {
            continue;
        }

        for (const propertyValue of Object.values(candidate)) {
            if (isLikelyActiveInstanceArray(propertyValue)) {
                return propertyValue;
            }
        }
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

function isRuntimeInstanceForObjectContext(candidate: unknown, objectContext: unknown): boolean {
    if (!isRecord(candidate) || !isRecord(objectContext)) {
        return false;
    }

    if (candidate.pObject === objectContext || candidate._kx === objectContext) {
        return true;
    }

    for (const value of Object.values(candidate)) {
        if (value === objectContext) {
            return true;
        }
    }

    return false;
}

function isRuntimeScriptName(value: unknown): value is string {
    return typeof value === "string" && (value.startsWith("gml_Script_") || value.startsWith("gml_GlobalScript_"));
}

function isRuntimeScriptNameArray(value: unknown): value is Array<string> {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const entry of value) {
        if (isRuntimeScriptName(entry)) {
            return true;
        }
    }

    return false;
}

function isRuntimeFunctionArray(value: unknown): value is Array<RuntimeFunction> {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const entry of value) {
        if (typeof entry === "function") {
            return true;
        }
    }

    return false;
}

function isLikelyGameObjectRecord(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value) || "nodeType" in value) {
        return false;
    }

    let hasStringProperty = false;
    let hasFunctionProperty = false;
    for (const propertyValue of Object.values(value)) {
        if (typeof propertyValue === "string") {
            hasStringProperty = true;
        }

        if (typeof propertyValue === "function") {
            hasFunctionProperty = true;
        }

        if (hasStringProperty && hasFunctionProperty) {
            return true;
        }
    }

    return false;
}

function isLikelyGameObjectArray(value: unknown): value is Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const entry of value) {
        if (isLikelyGameObjectRecord(entry)) {
            return true;
        }
    }

    return false;
}

function isLikelyActiveInstanceArray(value: unknown): value is Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const entry of value) {
        if (!isRecord(entry) || !("x" in entry) || !("y" in entry)) {
            continue;
        }

        let hasStringProperty = false;
        let hasFunctionProperty = false;
        for (const propertyValue of Object.values(entry)) {
            if (typeof propertyValue === "string") {
                hasStringProperty = true;
            }

            if (typeof propertyValue === "function") {
                hasFunctionProperty = true;
            }
        }

        if (hasStringProperty && hasFunctionProperty) {
            return true;
        }
    }

    return false;
}

function isLikelyInstanceVariableArray(value: unknown): value is Array<Record<string, unknown>> {
    if (!Array.isArray(value)) {
        return false;
    }

    for (const entry of value) {
        if (isRecord(entry) && "id" in entry && isRecord(entry._kx) && ("x" in entry || "y" in entry)) {
            return true;
        }
    }

    return false;
}

function readGlobalProperty(globalScope: Record<string, unknown>, propertyName: string): unknown {
    try {
        return globalScope[propertyName];
    } catch {
        return undefined;
    }
}

function resolveObjectName(record: Record<string, unknown>, expectedName: string | null): string | null {
    if (typeof record.pName === "string") {
        return record.pName;
    }

    if (typeof record._h1 === "string") {
        return record._h1;
    }

    if (typeof record._j3 === "string") {
        return record._j3;
    }

    if (typeof record._J3 === "string") {
        return record._J3;
    }

    if (typeof record._Gy === "string") {
        return record._Gy;
    }

    if (expectedName && Object.values(record).includes(expectedName)) {
        return expectedName;
    }

    return null;
}

function resolveRuntimeId(patch: BasePatch): string {
    if (isNonEmptyString(patch.runtimeId)) {
        return patch.runtimeId;
    }

    return patch.id;
}

function resolveRuntimeGameData(globalScope: RuntimeBindingGlobals & Record<string, unknown>): RuntimeGameData {
    const jsonGame = globalScope.JSON_game;
    if (jsonGame !== null && typeof jsonGame === "object") {
        return {
            gmObjects: Array.isArray(jsonGame.GMObjects)
                ? jsonGame.GMObjects.filter(
                      (entry): entry is Record<string, unknown> => entry !== null && entry !== undefined
                  )
                : undefined,
            scriptNames: Array.isArray(jsonGame.ScriptNames) ? jsonGame.ScriptNames : undefined,
            scripts: Array.isArray(jsonGame.Scripts) ? jsonGame.Scripts : undefined
        };
    }

    const minifiedGameData = globalScope._a1;
    if (minifiedGameData !== null && typeof minifiedGameData === "object") {
        return {
            gmObjects: Array.isArray(minifiedGameData._52)
                ? minifiedGameData._52.filter(
                      (entry): entry is Record<string, unknown> => entry !== null && entry !== undefined
                  )
                : undefined,
            scriptNames: Array.isArray(minifiedGameData._98) ? minifiedGameData._98 : undefined,
            scripts: Array.isArray(minifiedGameData._a8) ? minifiedGameData._a8 : undefined
        };
    }

    // GameMaker's minifier changes the container and field names between
    // builds. Discover every runtime object table by shape so live reload
    // updates duplicate object/prototype containers used by the event loop.
    const discoveredGmObjects: Array<Record<string, unknown>> = [];
    let discoveredScriptNames: Array<string> | undefined;
    let discoveredScripts: Array<RuntimeFunction> | undefined;
    for (const propertyName of Object.keys(globalScope)) {
        const candidate = readGlobalProperty(globalScope, propertyName);
        if (!isRecord(candidate)) {
            continue;
        }

        for (const propertyValue of Object.values(candidate)) {
            if (isLikelyGameObjectArray(propertyValue)) {
                discoveredGmObjects.push(
                    ...propertyValue.filter(
                        (entry): entry is Record<string, unknown> => entry !== null && entry !== undefined
                    )
                );
                continue;
            }

            if (isLikelyGameObjectRecord(propertyValue)) {
                discoveredGmObjects.push(propertyValue);
                continue;
            }

            if (isRecord(propertyValue)) {
                for (const nestedPropertyValue of Object.values(propertyValue)) {
                    if (isLikelyGameObjectRecord(nestedPropertyValue)) {
                        discoveredGmObjects.push(nestedPropertyValue);
                    }
                }
            }

            if (!discoveredScriptNames && isRuntimeScriptNameArray(propertyValue)) {
                discoveredScriptNames = propertyValue;
                continue;
            }

            if (!discoveredScripts && isRuntimeFunctionArray(propertyValue)) {
                discoveredScripts = propertyValue;
            }
        }
    }

    if (discoveredGmObjects.length > 0 || (discoveredScriptNames && discoveredScripts)) {
        return {
            gmObjects: discoveredGmObjects.length > 0 ? discoveredGmObjects : undefined,
            scriptNames: discoveredScriptNames,
            scripts: discoveredScripts
        };
    }

    return {
        gmObjects: undefined,
        scriptNames: undefined,
        scripts: undefined
    };
}

function resolveRuntimeBuiltins(globalScope: RuntimeBindingGlobals): Record<string, unknown> | undefined {
    if (globalScope.g_pBuiltIn && typeof globalScope.g_pBuiltIn === "object") {
        return globalScope.g_pBuiltIn;
    }

    if (globalScope._g8 && typeof globalScope._g8 === "object") {
        return globalScope._g8;
    }

    const scope = globalScope as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(scope)) {
        try {
            const candidate = scope[key];
            if (
                candidate &&
                typeof candidate === "object" &&
                (candidate as Record<string, unknown>).__type === "[BuiltIn]"
            ) {
                return candidate as Record<string, unknown>;
            }
        } catch {}
    }

    return undefined;
}

function resolveRuntimeBuiltinScope(
    globalScope: RuntimeBindingGlobals & Record<string, unknown>
): Record<string, unknown> {
    const runtimeBuiltins = resolveRuntimeBuiltins(globalScope);
    const functions = resolveRuntimeBuiltinFunctions(globalScope);
    if (runtimeBuiltins === undefined) {
        return functions;
    }

    const scope = Object.create(runtimeBuiltins);
    Object.assign(scope, functions);
    return scope;
}

function resolveRuntimeBindingNames(runtimeId: string): Array<string> {
    if (runtimeId.startsWith("gml/script/")) {
        const name = runtimeId.slice("gml/script/".length);
        if (!name) {
            return [];
        }
        return [`gml_Script_${name}`, `gml_GlobalScript_${name}`];
    }

    if (runtimeId.startsWith("gml/object/")) {
        const parts = runtimeId.split("/");
        if (parts.length >= 4) {
            return [`gml_Object_${parts[2]}_${parts[3]}`];
        }
        return [];
    }

    return [runtimeId];
}

function resolveEventIndex(
    globalScope: RuntimeBindingGlobals & Record<string, unknown>,
    eventKey: string
): number | null {
    const mapping = EVENT_MAPPINGS.get(eventKey);
    if (!mapping) {
        return null;
    }

    const minifiedValue = globalScope[mapping.minified];
    if (typeof minifiedValue === "number") {
        return minifiedValue;
    }

    const standardValue = globalScope[mapping.standard];
    if (typeof standardValue === "number") {
        return standardValue;
    }

    return null;
}

function markEventIndexAsEnabled(eventCollection: unknown, index: number | null): void {
    if (typeof index !== "number" || !Array.isArray(eventCollection)) {
        return;
    }

    eventCollection[index] = true;
}

function resolveNamedFunctionId(runtimeId: string): string | null {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(runtimeId)) {
        return null;
    }

    return runtimeId;
}

function resolveMinifiedObjectEventKey(
    objectEntry: Record<string, unknown>,
    minifiedFunctionOrdinal: number | null
): string | null {
    if (minifiedFunctionOrdinal === null) {
        return null;
    }

    const functionPropertyNames = Object.entries(objectEntry)
        .filter(([_propertyName, propertyValue]) => typeof propertyValue === "function")
        .map(([propertyName]) => propertyName);
    return functionPropertyNames[minifiedFunctionOrdinal] ?? null;
}

function resolveObjectEventKeys(eventName: string, objectEntry: Record<string, unknown>): Array<string> {
    // More specific prefixes must be checked before their general prefix
    // to avoid incorrect matches (e.g. "StepBegin_0" must not match "Step").
    for (const { prefixes, eventKey } of OBJECT_EVENT_PREFIX_MAPPINGS) {
        if (prefixes.some((prefix) => eventName.startsWith(prefix))) {
            const mapping = OBJECT_EVENT_PREFIX_MAPPINGS.find((entry) => entry.eventKey === eventKey);
            if (!mapping) {
                return [eventKey];
            }

            const keys = [mapping.eventKey, mapping.minifiedEventKey];
            const minifiedObjectEventKey = resolveMinifiedObjectEventKey(objectEntry, mapping.minifiedFunctionOrdinal);
            if (minifiedObjectEventKey) {
                keys.push(minifiedObjectEventKey);
            }
            return Array.from(new Set(keys));
        }
    }

    return [];
}

function parseObjectRuntimeId(runtimeId: string): { objectName: string; eventName: string } | null {
    if (!runtimeId.startsWith("gml_Object_")) {
        return null;
    }

    const withoutPrefix = runtimeId.slice("gml_Object_".length);
    const parts = withoutPrefix.split("_");
    if (parts.length < 2) {
        return null;
    }

    const eventName = parts.slice(-2).join("_");
    const objectName = parts.slice(0, -2).join("_");
    if (!objectName || !eventName) {
        return null;
    }

    return { objectName, eventName };
}

function createNamedRuntimeFunction(runtimeId: string, rawFn: RuntimeFunction): RuntimeFunction {
    const name = resolveNamedFunctionId(runtimeId);
    if (!name) {
        return rawFn;
    }

    const wrapperFactory = new Function(
        "rawFn",
        `return function ${name}(self, other, args) { return rawFn.call(this, self, other, args); }`
    ) as (rawFn: RuntimeFunction) => RuntimeFunction;

    return wrapperFactory(rawFn);
}

function visitNamedFunctionProperties(
    record: Record<string, unknown>,
    visitProperty: (propertyName: string, functionValue: RuntimeFunction) => void
): void {
    for (const [propertyName, propertyValue] of Object.entries(record)) {
        if (typeof propertyValue !== "function") {
            continue;
        }

        visitProperty(propertyName, propertyValue as RuntimeFunction);
    }
}

function updateGMObjects(
    gmObjects: Array<Record<string, unknown>>,
    objectRuntime: { objectName: string; eventName: string } | null,
    fn: RuntimeFunction,
    instanceKeysToUpdate: Set<string>,
    name: string,
    replacedFunctions: Set<RuntimeFunction>
): string | null {
    let objectName: string | null = null;
    for (const objectEntry of gmObjects) {
        const entryObjectName = resolveObjectName(objectEntry, objectRuntime?.objectName ?? null);
        if (
            objectRuntime &&
            entryObjectName === objectRuntime.objectName &&
            resolveObjectEventKeys(objectRuntime.eventName, objectEntry).length > 0
        ) {
            const objectEventKeys = resolveObjectEventKeys(objectRuntime.eventName, objectEntry);
            for (const objectEventKey of objectEventKeys) {
                const previousHandler = objectEntry[objectEventKey];
                if (typeof previousHandler === "function") {
                    replacedFunctions.add(previousHandler as RuntimeFunction);
                }
                objectEntry[objectEventKey] = fn;
                instanceKeysToUpdate.add(objectEventKey);
            }
            if (!objectName) {
                objectName = objectRuntime.objectName;
            }
        }

        visitNamedFunctionProperties(objectEntry, (propertyName, propertyFunction) => {
            if (propertyFunction.name !== name) {
                return;
            }

            replacedFunctions.add(propertyFunction);
            objectEntry[propertyName] = fn;
            instanceKeysToUpdate.add(propertyName);

            if (!objectName) {
                objectName = entryObjectName;
            }
        });
    }
    return objectName;
}

function updateGlobalRuntimeFunctionAliases(
    globalScope: Record<string, unknown>,
    replacedFunctions: ReadonlySet<RuntimeFunction>,
    fn: RuntimeFunction
): void {
    if (replacedFunctions.size === 0) {
        return;
    }

    for (const propertyName of Object.keys(globalScope)) {
        const propertyValue = readGlobalProperty(globalScope, propertyName);
        if (typeof propertyValue !== "function" || !replacedFunctions.has(propertyValue as RuntimeFunction)) {
            continue;
        }

        globalScope[propertyName] = fn;
    }
}

function discoverInstanceObjectDefinition(instance: Record<string, unknown>): Record<string, unknown> | null {
    const rawPObject = instance.pObject ?? instance._kx;
    if (isRecord(rawPObject)) {
        return rawPObject;
    }
    for (const value of Object.values(instance)) {
        if (isRecord(value)) {
            let hasString = false;
            let hasFunction = false;
            for (const subVal of Object.values(value)) {
                if (typeof subVal === "string") {
                    hasString = true;
                }
                if (typeof subVal === "function") {
                    hasFunction = true;
                }
                if (hasString && hasFunction) {
                    return value;
                }
            }
        }
    }
    return null;
}

function updateInstance(
    instance: Record<string, unknown>,
    instanceKeysToUpdate: Set<string>,
    fn: RuntimeFunction,
    globalScope: RuntimeBindingGlobals & Record<string, unknown>,
    name: string
) {
    for (const key of instanceKeysToUpdate) {
        instance[key] = fn;

        // Also update the object definition (pObject) which the event loop uses
        const pObject = discoverInstanceObjectDefinition(instance);
        if (pObject !== null && pObject[key] !== fn) {
            pObject[key] = fn;
        }

        const eventIndex = resolveEventIndex(globalScope, key);
        markEventIndexAsEnabled(instance.Event, eventIndex);
        markEventIndexAsEnabled(pObject?.Event, eventIndex);
    }

    visitNamedFunctionProperties(instance, (propertyName, propertyFunction) => {
        if (propertyFunction.name !== name) {
            return;
        }

        instance[propertyName] = fn;
    });
}

function updateInstances(
    instanceStore: InstanceStore,
    objectName: string | null,
    instanceKeysToUpdate: Set<string>,
    fn: RuntimeFunction,
    globalScope: RuntimeBindingGlobals & Record<string, unknown>,
    name: string
) {
    for (const instance of Object.values(instanceStore)) {
        if (!instance || typeof instance !== "object") {
            continue;
        }

        if (objectName) {
            const instanceObject = discoverInstanceObjectDefinition(instance as Record<string, unknown>);
            const instanceObjectName = instanceObject ? resolveObjectName(instanceObject, objectName) : null;
            if (instanceObjectName && instanceObjectName !== objectName) {
                continue;
            }
        }

        updateInstance(instance as Record<string, unknown>, instanceKeysToUpdate, fn, globalScope, name);
    }
}

function resolveInstanceObjectName(instance: Record<string, unknown>, expectedName: string | null): string | null {
    const rawObject = discoverInstanceObjectDefinition(instance);
    if (isRecord(rawObject)) {
        const objectName = resolveObjectName(rawObject, expectedName);
        if (objectName !== null) {
            return objectName;
        }
    }

    return resolveObjectName(instance, expectedName);
}

function appendNestedVariableInstances(
    instance: Record<string, unknown>,
    instances: Array<Record<string, unknown>>,
    seenInstances: Set<Record<string, unknown>>,
    depth: number
): void {
    if (depth > 2) {
        return;
    }

    for (const value of Object.values(instance)) {
        if (Array.isArray(value)) {
            for (const entry of value) {
                if (!isRecord(entry) || !("id" in entry) || seenInstances.has(entry)) {
                    continue;
                }

                seenInstances.add(entry);
                instances.push(entry);
            }
            continue;
        }

        if (isRecord(value)) {
            appendNestedVariableInstances(value, instances, seenInstances, depth + 1);
        }
    }
}

function collectObjectInstances(instanceStore: InstanceStore, objectName: string): Array<Record<string, unknown>> {
    const instances: Array<Record<string, unknown>> = [];
    const seenInstances = new Set<Record<string, unknown>>();
    for (const instance of Object.values(instanceStore)) {
        if (!isRecord(instance)) {
            continue;
        }

        if (resolveInstanceObjectName(instance, objectName) !== objectName) {
            continue;
        }

        if (!seenInstances.has(instance)) {
            seenInstances.add(instance);
            instances.push(instance);
        }
        appendNestedVariableInstances(instance, instances, seenInstances, 0);
    }

    return instances;
}

function collectObjectOwnedInstances(
    objectEntry: Record<string, unknown>,
    instances: Array<Record<string, unknown>>,
    seenInstances: Set<Record<string, unknown>>
): void {
    appendNestedVariableInstances(objectEntry, instances, seenInstances, 0);
}

function resolveObjectCreateBindings(
    gmObjects: Array<Record<string, unknown>>,
    objectName: string
): Array<{ objectEntry: Record<string, unknown>; createHandler: RuntimeFunction }> {
    const bindings: Array<{ objectEntry: Record<string, unknown>; createHandler: RuntimeFunction }> = [];
    for (const objectEntry of gmObjects) {
        if (resolveObjectName(objectEntry, objectName) !== objectName) {
            continue;
        }

        for (const eventKey of resolveObjectEventKeys("Create_0", objectEntry)) {
            const eventHandler = objectEntry[eventKey];
            if (typeof eventHandler === "function") {
                bindings.push({
                    objectEntry,
                    createHandler: eventHandler as RuntimeFunction
                });
                break;
            }
        }
    }

    return bindings;
}

function refreshObjectInstancesAfterEventPatch(binding: RuntimeBindingApplication): void {
    if (binding.objectRuntime === null || binding.gmObjects === undefined) {
        return;
    }

    if (binding.objectRuntime.eventName !== "Create_0") {
        return;
    }

    const createBindings = resolveObjectCreateBindings(binding.gmObjects, binding.objectRuntime.objectName);
    if (createBindings.length === 0) {
        return;
    }

    for (const createBinding of createBindings) {
        const instances =
            binding.instanceStore === undefined
                ? []
                : collectObjectInstances(binding.instanceStore, binding.objectRuntime.objectName);
        const seenInstances = new Set(instances);
        collectObjectOwnedInstances(createBinding.objectEntry, instances, seenInstances);
        for (const instance of instances) {
            createBinding.createHandler.call(instance, instance, instance, []);
        }
    }
}

function applyRuntimeBindings(patch: BasePatch, fn: RuntimeFunction): RuntimeBindingApplication {
    const runtimeId = resolveRuntimeId(patch);
    const targetNames = resolveRuntimeBindingNames(runtimeId);
    if (targetNames.length === 0) {
        return {
            gmObjects: undefined,
            instanceStore: undefined,
            objectName: null,
            objectRuntime: null
        };
    }

    const globalScope = globalThis as RuntimeBindingGlobals & Record<string, unknown>;
    const gameData = resolveRuntimeGameData(globalScope);
    const { gmObjects, scriptNames, scripts } = gameData;
    const instanceStore = resolveInstanceStore(globalScope);
    let objectName: string | null = null;
    const instanceKeysToUpdate = new Set<string>();
    const replacedFunctions = new Set<RuntimeFunction>();

    const objectRuntime = parseObjectRuntimeId(runtimeId);

    const resolvedNames = new Set(targetNames);
    const fallbackScriptMatch =
        runtimeId.startsWith("gml/script/") && runtimeId === patch.id ? runtimeId.slice("gml/script/".length) : null;

    if (fallbackScriptMatch && Array.isArray(gmObjects)) {
        for (const objectEntry of gmObjects) {
            visitNamedFunctionProperties(objectEntry, (_propertyName, propertyFunction) => {
                if (
                    propertyFunction.name.startsWith("gml_Object_") &&
                    propertyFunction.name.endsWith(`_${fallbackScriptMatch}`)
                ) {
                    resolvedNames.add(propertyFunction.name);
                }
            });
        }
    }

    // Build the reverse-lookup map once per patch application so that all
    // names in resolvedNames are looked up in O(1) rather than O(n).
    const scriptNameIndex = Array.isArray(scriptNames) ? resolveScriptNameIndex(scriptNames) : null;

    for (const name of resolvedNames) {
        const scriptIdx = scriptNameIndex?.get(name) ?? -1;

        if (typeof globalScope[name] === "function" || scriptIdx !== -1) {
            globalScope[name] = fn;
        }

        if (scriptIdx !== -1 && Array.isArray(scripts) && scriptIdx < scripts.length) {
            scripts[scriptIdx] = fn;
        }

        if (Array.isArray(gmObjects)) {
            const foundName = updateGMObjects(
                gmObjects,
                objectRuntime,
                fn,
                instanceKeysToUpdate,
                name,
                replacedFunctions
            );
            if (!objectName && foundName) {
                objectName = foundName;
            }
        }

        updateGlobalRuntimeFunctionAliases(globalScope, replacedFunctions, fn);

        if (instanceStore && typeof instanceStore === "object") {
            updateInstances(instanceStore, objectName, instanceKeysToUpdate, fn, globalScope, name);
        }
    }

    return {
        gmObjects,
        instanceStore,
        objectName,
        objectRuntime
    };
}

export function createRegistry(overrides?: RuntimeRegistryOverrides): RuntimeRegistry {
    return {
        version: overrides?.version ?? 0,
        scripts: overrides?.scripts ?? Object.create(null),
        events: overrides?.events ?? Object.create(null),
        closures: overrides?.closures ?? Object.create(null)
    };
}

export function validatePatch(patch: unknown): asserts patch is Patch {
    if (!patch || typeof patch !== "object") {
        throw new TypeError("applyPatch expects a patch object");
    }

    const candidate = patch as Record<string, unknown>;

    if (!("kind" in candidate)) {
        throw new TypeError("Patch must have a 'kind' field");
    }

    if (!("id" in candidate)) {
        throw new TypeError("Patch must have an 'id' field");
    }

    const kindValue = candidate.kind;
    if (typeof kindValue !== "string") {
        throw new TypeError("Patch 'kind' must be a string");
    }
    const kind = kindValue;
    if (!isSupportedPatchKind(kind)) {
        throw new TypeError(`Unsupported patch kind: ${kind}`);
    }

    const idValue = candidate.id;
    if (!idValue || typeof idValue !== "string") {
        throw new TypeError("Patch must specify an 'id' string");
    }
}

export interface DependencyValidationResult {
    satisfied: boolean;
    missingDependencies: Array<string>;
}

function hasRegistryDependency(registry: RuntimeRegistry, dependencyId: string): boolean {
    return dependencyId in registry.scripts || dependencyId in registry.events || dependencyId in registry.closures;
}

function hasGlobalFunction(globalScope: Record<string, unknown>, functionName: string): boolean {
    return typeof globalScope[functionName] === "function";
}

function hasRuntimeScriptDependency(globalScope: Record<string, unknown>, dependencyId: string): boolean {
    if (!dependencyId.startsWith("gml/script/")) {
        return false;
    }

    const scriptName = dependencyId.slice("gml/script/".length);
    if (scriptName.length === 0) {
        return false;
    }

    if (isRuntimeBuiltinFunction(scriptName)) {
        return true;
    }

    return (
        hasGlobalFunction(globalScope, scriptName) ||
        hasGlobalFunction(globalScope, `gml_Script_${scriptName}`) ||
        hasGlobalFunction(globalScope, `gml_GlobalScript_${scriptName}`)
    );
}

function hasRuntimeObjectEventDependency(globalScope: Record<string, unknown>, dependencyId: string): boolean {
    if (!dependencyId.startsWith("gml/event/")) {
        return false;
    }

    const parts = dependencyId.split("/");
    if (parts.length !== 4) {
        return false;
    }

    return hasGlobalFunction(globalScope, `gml_Object_${parts[2]}_${parts[3]}`);
}

function hasRuntimeDependency(dependencyId: string): boolean {
    const globalScope = globalThis as Record<string, unknown>;
    return (
        hasRuntimeScriptDependency(globalScope, dependencyId) ||
        hasRuntimeObjectEventDependency(globalScope, dependencyId)
    );
}

function hasSatisfiedDependency(registry: RuntimeRegistry, dependencyId: string): boolean {
    return hasRegistryDependency(registry, dependencyId) || hasRuntimeDependency(dependencyId);
}

function collectMissingDependencies(
    dependencies: ReadonlyArray<unknown>,
    hasDependency: (dependencyId: string) => boolean
): Array<string> {
    const missingDependencies: Array<string> = [];
    const checkedDependencies = new Set<string>();

    for (const dependencyCandidate of dependencies) {
        if (typeof dependencyCandidate !== "string" || dependencyCandidate.length === 0) {
            continue;
        }

        if (checkedDependencies.has(dependencyCandidate)) {
            continue;
        }
        checkedDependencies.add(dependencyCandidate);

        if (!hasDependency(dependencyCandidate)) {
            missingDependencies.push(dependencyCandidate);
        }
    }

    return missingDependencies;
}

export function validatePatchDependencies(patch: Patch, registry: RuntimeRegistry): DependencyValidationResult {
    const dependencies = patch.metadata?.dependencies;

    if (!isNonEmptyArray(dependencies)) {
        return { satisfied: true, missingDependencies: [] };
    }

    const missingDependencies = collectMissingDependencies(dependencies, (dependencyId) =>
        hasSatisfiedDependency(registry, dependencyId)
    );

    return {
        satisfied: missingDependencies.length === 0,
        missingDependencies
    };
}

export type BatchDependencyValidationResult =
    | { satisfied: true }
    | {
          satisfied: false;
          failedIndex: number;
          missingDependencies: Array<string>;
      };

/**
 * Validates patch dependencies in the order a batch will be applied.
 *
 * Dependencies can be satisfied either by the current registry state or by
 * patches that appear earlier in the same batch.
 */
export function validateBatchPatchDependencies(
    patches: ReadonlyArray<Patch>,
    registry: RuntimeRegistry
): BatchDependencyValidationResult {
    const newlySatisfiedDependencies = new Set<string>();

    for (const [index, patch] of patches.entries()) {
        const dependencies = patch.metadata?.dependencies;
        if (isNonEmptyArray(dependencies)) {
            const missingDependencies = collectMissingDependencies(
                dependencies,
                (dependencyId) =>
                    newlySatisfiedDependencies.has(dependencyId) || hasSatisfiedDependency(registry, dependencyId)
            );
            if (missingDependencies.length > 0) {
                return {
                    satisfied: false,
                    failedIndex: index,
                    missingDependencies
                };
            }
        }

        newlySatisfiedDependencies.add(patch.id);
    }

    return { satisfied: true };
}

export function applyPatchToRegistry(registry: RuntimeRegistry, patch: Patch): RuntimeRegistry {
    const handler = resolvePatchKindHandler(patch.kind);
    return handler.apply(registry, patch);
}

export function captureSnapshot(registry: RuntimeRegistry, patch: Patch): PatchSnapshot {
    const snapshot: PatchSnapshot = {
        id: patch.id,
        kind: patch.kind,
        version: registry.version,
        previous: null
    };

    const handler = resolvePatchKindHandler(patch.kind);
    snapshot.previous = registry[handler.key][patch.id] ?? null;

    return snapshot;
}

export function restoreSnapshot(registry: RuntimeRegistry, snapshot: PatchSnapshot): RuntimeRegistry {
    const handler = resolvePatchKindHandler(snapshot.kind);
    return restoreEntry(registry, snapshot, handler.key);
}

export function testPatchInShadow(patch: Patch): ShadowTestResult {
    const shadowRegistry = createRegistry();

    try {
        applyPatchToRegistry(shadowRegistry, patch);
        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            error: isErrorLike(error) ? error.message : String(error ?? "Unknown error")
        };
    }
}

export function applyPatchInternal(
    stateRegistry: RuntimeRegistry,
    patch: Patch
): { registry: RuntimeRegistry; result: ApplyPatchResult } {
    const updatedRegistry = applyPatchToRegistry(stateRegistry, patch);

    const nextRegistry: RuntimeRegistry = {
        ...updatedRegistry,
        version: stateRegistry.version + 1
    };

    return {
        registry: nextRegistry,
        result: { success: true, version: nextRegistry.version }
    };
}

function requirePatchBody(patch: Patch, label: string): string {
    const body = patch.js_body;
    if (!body || typeof body !== "string") {
        throw new TypeError(`${label} patch must have a 'js_body' string`);
    }

    return body;
}

function applyScriptPatch(registry: RuntimeRegistry, patch: ScriptPatch): RuntimeRegistry {
    const patchBody = requirePatchBody(patch, "Script");

    const rawFn = new Function(
        "self",
        "other",
        "args",
        "__gml_constants",
        "__gml_builtins",
        `const __gml_scope = self && typeof self === "object" ? self : Object.create(null);
const __global_scope = typeof globalThis === "object" && globalThis !== null ? globalThis : null;
const __html_color_pattern = /^rgba?\\(/;
const __is_html_color_string = (value) => typeof value === "string" && __html_color_pattern.test(value);
const __resolveSpriteConstant = (prop) => {
    const jsonGame = __global_scope?.JSON_game;
    const sprites = jsonGame?.Sprites;
    if (Array.isArray(sprites)) {
        const index = sprites.findIndex(
            (sprite) => sprite?.pName === prop || sprite?.Name === prop
        );
        if (index !== -1) {
            return index;
        }
    }

    const spriteManager = __global_scope?.g_pSpriteManager;
    if (spriteManager && typeof spriteManager.Sprite_Find === "function") {
        const value = spriteManager.Sprite_Find(prop);
        if (typeof value === "number" && value >= 0) {
            return value;
        }
    }

    return undefined;
};
const __resolveScriptFunction = (prop) => {
    const jsonGame = __global_scope?.JSON_game;
    const scriptNames = jsonGame?.ScriptNames;
    const scripts = jsonGame?.Scripts;
    if (!Array.isArray(scriptNames) || !Array.isArray(scripts)) {
        return undefined;
    }

    const scriptIndex = scriptNames.indexOf(\`gml_Script_\${prop}\`);
    if (scriptIndex !== -1 && scriptIndex < scripts.length) {
        return scripts[scriptIndex];
    }

    const globalScriptIndex = scriptNames.indexOf(\`gml_GlobalScript_\${prop}\`);
    if (globalScriptIndex !== -1 && globalScriptIndex < scripts.length) {
        return scripts[globalScriptIndex];
    }

    return undefined;
};
let __gml_minified_property_map = null;
let __gml_minified_property_map_resolved = false;
const __isMinifiedGmlPropertyMap = (value) =>
    value &&
    typeof value === "object" &&
    typeof value.mouse_x === "string" &&
    typeof value.current_time === "string" &&
    typeof value.variable_instance_get === "string";
const __resolveMinifiedGmlPropertyMap = () => {
    if (__gml_minified_property_map_resolved) {
        return __gml_minified_property_map;
    }
    if (!__global_scope) {
        return null;
    }
    if (__isMinifiedGmlPropertyMap(__global_scope._bw)) {
        __gml_minified_property_map = __global_scope._bw;
        __gml_minified_property_map_resolved = true;
        return __gml_minified_property_map;
    }
    for (const globalPropertyName of Object.getOwnPropertyNames(__global_scope)) {
        const value = __global_scope[globalPropertyName];
        if (__isMinifiedGmlPropertyMap(value)) {
            __gml_minified_property_map = value;
            __gml_minified_property_map_resolved = true;
            return __gml_minified_property_map;
        }
    }
    return null;
};
const __resolveMinifiedGmlPropertyKey = (prop) => {
    const minifiedPropertyMap = __resolveMinifiedGmlPropertyMap();
    if (minifiedPropertyMap !== null) {
        const mapped = minifiedPropertyMap[prop];
        if (typeof mapped === "string" && mapped.length > 0) {
            return mapped;
        }
    }
    return null;
};
const __computeGmlPropertyNames = (prop) => {
    const mappedProp = __resolveMinifiedGmlPropertyKey(prop);
    const names = [prop, \`gml\${prop}\`, \`__\${prop}\`];
    if (mappedProp !== null) {
        names.unshift(mappedProp);
    }
    return names;
};
const __resolveExistingGmlPropertyKey = (target, prop) => {
    for (const propertyName of __computeGmlPropertyNames(prop)) {
        if (propertyName in target) {
            return propertyName;
        }
    }
    return null;
};
const __resolveWritableGmlPropertyKey = (target, prop) => {
    const existingKey = __resolveExistingGmlPropertyKey(target, prop);
    if (existingKey !== null) {
        return existingKey;
    }
    return __resolveMinifiedGmlPropertyKey(prop) ?? prop;
};
	const __gml_proxy = new Proxy(__gml_scope, {
	    has(target, prop) {
	        if (typeof prop !== "string") {
	            return prop in target;
	        }
	        if (prop === "self") {
	            return true;
	        }
	        const key = __resolveExistingGmlPropertyKey(target, prop);
	        if (key !== null) {
	            return true;
        }
        const __has_global_value = __global_scope && prop in __global_scope;
        if (Object.prototype.hasOwnProperty.call(__gml_constants, prop)) {
            return true;
        }
        const __global_value = __has_global_value ? __global_scope[prop] : undefined;
        if (__has_global_value && __global_value !== undefined) {
            return true;
        }
        if (__resolveSpriteConstant(prop) !== undefined) {
            return true;
        }
        if (__resolveScriptFunction(prop) !== undefined) {
            return true;
        }
        if (
            __gml_builtins &&
            typeof __gml_builtins[\`get_\${prop}\`] === "function"
        ) {
            return true;
        }
        if (__gml_builtins && prop in __gml_builtins) {
            return true;
        }
        return false;
    },
	    get(target, prop, receiver) {
	        if (typeof prop !== "string") {
	            return Reflect.get(target, prop, receiver);
	        }
	        if (prop === "self") {
	            return __gml_proxy;
	        }
	        const key = __resolveExistingGmlPropertyKey(target, prop);
	        if (key !== null) {
	            return Reflect.get(target, key, receiver);
        }
        const __has_global_value = __global_scope && prop in __global_scope;
        const __global_value = __has_global_value ? __global_scope[prop] : undefined;
        const __sprite_constant = __resolveSpriteConstant(prop);
        const __script_function = __resolveScriptFunction(prop);
        if (Object.prototype.hasOwnProperty.call(__gml_constants, prop)) {
            if (__global_value === undefined || __is_html_color_string(__global_value)) {
                return __gml_constants[prop];
            }
            return __global_value;
        }
        if (__has_global_value && __global_value !== undefined) {
            return __global_value;
        }
        if (__sprite_constant !== undefined) {
            return __sprite_constant;
        }
        if (__script_function !== undefined) {
            return __script_function;
        }
        if (__gml_builtins) {
            const getter = __gml_builtins[\`get_\${prop}\`];
            if (typeof getter === "function") {
                return getter.call(__gml_builtins);
            }
            if (prop in __gml_builtins) {
                return __gml_builtins[prop];
            }
        }
        return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
        if (typeof prop !== "string") {
            return Reflect.set(target, prop, value, receiver);
        }
        const key = __resolveExistingGmlPropertyKey(target, prop);
        if (key !== null) {
            return Reflect.set(target, key, value);
        }
        return Reflect.set(target, __resolveWritableGmlPropertyKey(target, prop), value);
    }
});
with (__gml_proxy) {
${patchBody}
}`
    ) as RuntimeFunction;

    const fn = ((self, other, args) => {
        const globals = globalThis as RuntimeBindingGlobals & Record<string, unknown>;
        const constants = resolveBuiltinConstants(globals);
        const builtins = resolveRuntimeBuiltinScope(globals);
        return rawFn.call(self, self, other, args, constants, builtins);
    }) as RuntimeFunction;
    const namedFn = createNamedRuntimeFunction(resolveRuntimeId(patch), fn);

    applyRuntimeBindings(patch, namedFn);

    return updateRegistryCollection(registry, "scripts", patch.id, namedFn);
}

function applyEventPatch(registry: RuntimeRegistry, patch: EventPatch): RuntimeRegistry {
    const patchBody = requirePatchBody(patch, "Event");

    const thisName = patch.this_name || "self";
    const trimmedArgs = patch.js_args?.trim() ?? "";
    const hasCustomArgs = trimmedArgs.length > 0;
    const argsDecl = hasCustomArgs ? trimmedArgs : "other";
    const fn = new Function(
        thisName,
        argsDecl,
        "__gml_constants",
        "__gml_builtins",
        `const __gml_scope = ${thisName} && typeof ${thisName} === "object" ? ${thisName} : Object.create(null);
const __global_scope = typeof globalThis === "object" && globalThis !== null ? globalThis : null;
let __gml_minified_property_map = null;
let __gml_minified_property_map_resolved = false;
const __isMinifiedGmlPropertyMap = (value) =>
    value &&
    typeof value === "object" &&
    typeof value.mouse_x === "string" &&
    typeof value.current_time === "string" &&
    typeof value.variable_instance_get === "string";
const __resolveMinifiedGmlPropertyMap = () => {
    if (__gml_minified_property_map_resolved) {
        return __gml_minified_property_map;
    }
    if (!__global_scope) {
        return null;
    }
    if (__isMinifiedGmlPropertyMap(__global_scope._bw)) {
        __gml_minified_property_map = __global_scope._bw;
        __gml_minified_property_map_resolved = true;
        return __gml_minified_property_map;
    }
    for (const globalPropertyName of Object.getOwnPropertyNames(__global_scope)) {
        const value = __global_scope[globalPropertyName];
        if (__isMinifiedGmlPropertyMap(value)) {
            __gml_minified_property_map = value;
            __gml_minified_property_map_resolved = true;
            return __gml_minified_property_map;
        }
    }
    return null;
};
const __resolveMinifiedGmlPropertyKey = (prop) => {
    const minifiedPropertyMap = __resolveMinifiedGmlPropertyMap();
    if (minifiedPropertyMap !== null) {
        const mapped = minifiedPropertyMap[prop];
        if (typeof mapped === "string" && mapped.length > 0) {
            return mapped;
        }
    }
    return null;
};
const __computeGmlPropertyNames = (prop) => {
    const mappedProp = __resolveMinifiedGmlPropertyKey(prop);
    const names = [prop, \`gml\${prop}\`, \`__\${prop}\`];
    if (mappedProp !== null) {
        names.unshift(mappedProp);
    }
    return names;
};
const __resolveExistingGmlPropertyKey = (target, prop) => {
    for (const propertyName of __computeGmlPropertyNames(prop)) {
        if (propertyName in target) {
            return propertyName;
        }
    }
    return null;
};
const __resolveWritableGmlPropertyKey = (target, prop) => {
    const existingKey = __resolveExistingGmlPropertyKey(target, prop);
    if (existingKey !== null) {
        return existingKey;
    }
    return __resolveMinifiedGmlPropertyKey(prop) ?? prop;
};
const __runtime_value_names = new Set(["mouse_x", "mouse_y", "current_time"]);
const __resolveRuntimeGetter = (prop) => {
    const getterName = \`get_\${prop}\`;
    const directGetter = __global_scope?.[getterName];
    if (typeof directGetter === "function") {
        return directGetter;
    }
    const minifiedGetterName = __resolveMinifiedGmlPropertyKey(getterName);
    if (minifiedGetterName !== null) {
        const minifiedGetter = __global_scope?.[minifiedGetterName];
        if (typeof minifiedGetter === "function") {
            return minifiedGetter;
        }
        const builtinMinifiedGetter = __gml_builtins?.[minifiedGetterName];
        if (typeof builtinMinifiedGetter === "function") {
            return builtinMinifiedGetter;
        }
    }
    const builtinGetter = __gml_builtins?.[getterName];
    if (typeof builtinGetter === "function") {
        return builtinGetter;
    }
    return null;
};
const __resolveRuntimeValue = (prop) => {
    if (!__runtime_value_names.has(prop)) {
        return undefined;
    }
    if (__global_scope && typeof __global_scope[prop] !== "undefined") {
        return __global_scope[prop];
    }
    const getter = __resolveRuntimeGetter(prop);
    if (getter !== null) {
        return getter.call(__gml_builtins ?? __global_scope);
    }
    if (prop === "mouse_x") {
        return __gml_scope.x;
    }
    if (prop === "mouse_y") {
        return __gml_scope.y;
    }
    if (prop === "current_time") {
        return Date.now();
    }
    return undefined;
};
	const __gml_proxy = new Proxy(__gml_scope, {
	    has(target, prop) {
	        if (typeof prop !== "string") {
	            return prop in target;
	        }
	        if (prop === "self") {
	            return true;
	        }
	        const key = __resolveExistingGmlPropertyKey(target, prop);
	        if (key !== null) {
	            return true;
        }
        return (
            Object.prototype.hasOwnProperty.call(__gml_constants, prop) ||
            Object.prototype.hasOwnProperty.call(__gml_builtins, prop) ||
            __runtime_value_names.has(prop) ||
            __resolveRuntimeValue(prop) !== undefined ||
            (__global_scope !== null && prop in __global_scope)
        );
    },
	    get(target, prop, receiver) {
	        if (typeof prop !== "string") {
	            return Reflect.get(target, prop, receiver);
	        }
	        if (prop === "self") {
	            return __gml_proxy;
	        }
	        const key = __resolveExistingGmlPropertyKey(target, prop);
	        if (key !== null) {
	            return Reflect.get(target, key, receiver);
        }
        if (Object.prototype.hasOwnProperty.call(__gml_constants, prop)) {
            return __gml_constants[prop];
        }
        if (Object.prototype.hasOwnProperty.call(__gml_builtins, prop)) {
            return __gml_builtins[prop];
        }
        const runtimeValue = __resolveRuntimeValue(prop);
        if (runtimeValue !== undefined) {
            return runtimeValue;
        }
        return __global_scope !== null ? __global_scope[prop] : undefined;
    },
    set(target, prop, value, receiver) {
        if (typeof prop !== "string") {
            return Reflect.set(target, prop, value, receiver);
        }
        return Reflect.set(target, __resolveWritableGmlPropertyKey(target, prop), value);
    }
});
${thisName} = __gml_proxy;
with (__gml_proxy) {
${patchBody}
}`
    ) as RuntimeFunction;

    const eventWrapper = function (this: unknown, ...incomingArgs: Array<unknown>) {
        const firstArg = incomingArgs[0];
        const hasInstanceArgument = !hasCustomArgs && firstArg !== null && typeof firstArg === "object";
        const hasInstanceContext = this !== undefined && this !== globalThis;
        const self =
            hasInstanceContext && isRuntimeInstanceForObjectContext(firstArg, this)
                ? firstArg
                : hasInstanceContext
                  ? this
                  : hasInstanceArgument
                    ? firstArg
                    : (firstArg ?? this);
        const other = incomingArgs[1] ?? self;
        const forwardedArgs = hasCustomArgs ? incomingArgs : [other];
        const globals = globalThis as RuntimeBindingGlobals & Record<string, unknown>;
        const constants = resolveBuiltinConstants(globals);
        const builtins = resolveRuntimeBuiltinScope(globals);
        return fn.call(self, self, ...forwardedArgs, constants, builtins);
    };

    const namedFn = createNamedRuntimeFunction(resolveRuntimeId(patch), eventWrapper);
    const binding = applyRuntimeBindings(patch, namedFn);
    refreshObjectInstancesAfterEventPatch(binding);

    return updateRegistryCollection(registry, "events", patch.id, namedFn);
}

function applyClosurePatch(registry: RuntimeRegistry, patch: ClosurePatch): RuntimeRegistry {
    const patchBody = requirePatchBody(patch, "Closure");

    const fn = new Function("...args", patchBody) as RuntimeFunction;

    return updateRegistryCollection(registry, "closures", patch.id, fn);
}

function updateRegistryCollection(
    registry: RuntimeRegistry,
    key: RegistryCollectionKey,
    patchId: string,
    fn: RuntimeFunction
): RuntimeRegistry {
    return {
        ...registry,
        [key]: {
            ...registry[key],
            [patchId]: fn
        }
    };
}

type PatchKindHandler = {
    key: RegistryCollectionKey;
    apply: (registry: RuntimeRegistry, patch: Patch) => RuntimeRegistry;
};

// Pre-built handler lookup keyed by patch kind. The supported set of kinds is
// fixed at compile time, so we build the handlers once at module load and reuse
// them on every call. This avoids allocating a new object + closures on every
// `captureSnapshot`, `applyPatchToRegistry`, and `restoreSnapshot` invocation —
// calls that occur on the hot path during each 60 fps hot-reload cycle.
const PATCH_KIND_HANDLERS: ReadonlyMap<string, PatchKindHandler> = new Map<string, PatchKindHandler>([
    [
        "script",
        {
            key: getPatchKindMetadata("script").registryCollectionKey,
            apply: (registry, patch) => applyScriptPatch(registry, patch as ScriptPatch)
        }
    ],
    [
        "event",
        {
            key: getPatchKindMetadata("event").registryCollectionKey,
            apply: (registry, patch) => applyEventPatch(registry, patch as EventPatch)
        }
    ],
    [
        "closure",
        {
            key: getPatchKindMetadata("closure").registryCollectionKey,
            apply: (registry, patch) => applyClosurePatch(registry, patch as ClosurePatch)
        }
    ]
]);

function resolvePatchKindHandler(kind: Patch["kind"]): PatchKindHandler {
    const handler = PATCH_KIND_HANDLERS.get(kind);
    if (!handler) {
        throw new TypeError("Unsupported patch kind");
    }
    return handler;
}

function restoreEntry(registry: RuntimeRegistry, snapshot: PatchSnapshot, key: RegistryCollectionKey): RuntimeRegistry {
    const collection = { ...registry[key] };

    if (snapshot.previous) {
        collection[snapshot.id] = snapshot.previous;
    } else {
        delete collection[snapshot.id];
    }

    return {
        ...registry,
        [key]: collection
    };
}

export function calculateTimingMetrics(durations: Array<number>): {
    totalDurationMs: number;
    averagePatchDurationMs: number;
    fastestPatchMs: number;
    slowestPatchMs: number;
    p50DurationMs: number;
    p90DurationMs: number;
    p99DurationMs: number;
} | null {
    if (durations.length === 0) {
        return null;
    }

    let totalDurationMs = 0;
    let fastestPatchMs = durations[0];
    let slowestPatchMs = durations[0];

    for (const duration of durations) {
        totalDurationMs += duration;
        if (duration < fastestPatchMs) {
            fastestPatchMs = duration;
        }
        if (duration > slowestPatchMs) {
            slowestPatchMs = duration;
        }
    }

    const sorted = durations.toSorted((a, b) => a - b);
    const p50DurationMs = calculatePercentile(sorted, 50);
    const p90DurationMs = calculatePercentile(sorted, 90);
    const p99DurationMs = calculatePercentile(sorted, 99);

    return {
        totalDurationMs,
        averagePatchDurationMs: totalDurationMs / durations.length,
        fastestPatchMs,
        slowestPatchMs,
        p50DurationMs,
        p90DurationMs,
        p99DurationMs
    };
}

function calculatePercentile(sorted: Array<number>, percentile: number): number {
    if (sorted.length === 0) {
        return 0;
    }

    if (sorted.length === 1) {
        return sorted[0];
    }

    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    // If the fractional index is extremely close to an integer, return the
    // nearest element instead of performing an interpolation that can produce
    // slightly off values (especially when the neighbouring samples are far
    // apart). Floating-point precision can produce values like
    // 8.999999999999998 instead of an exact 9, so we compare the raw index to
    // its rounded integer rather than comparing floor/ceil directly.
    const nearest = Math.round(index);
    if (areNumbersApproximatelyEqual(index, nearest)) {
        return sorted[nearest];
    }

    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
