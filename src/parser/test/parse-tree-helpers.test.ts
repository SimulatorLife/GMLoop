import assert from "node:assert/strict";
import { test } from "node:test";

import {
    collectPrototypeMethodNames,
    collectVisitMethodNames,
    definePrototypeMethods,
    deriveListenerMethodNames
} from "../src/runtime/prototype-methods.js";
import { createWrapperSymbols, ensureHasInstancePatched } from "../src/runtime/symbol-patching.js";

function WrapperBase() {}
WrapperBase.prototype = {};

class SampleVisitor {
    visitProgram() {}
    visitChildren() {}
    visitTerminal() {}
    visitExpression() {}
}

(SampleVisitor.prototype as any).helper = () => "value";

function createBaseCtor() {}

createBaseCtor.prototype = {
    constructor: createBaseCtor,
    custom() {
        return "base";
    }
};

void test("collectVisitMethodNames filters generated visitor helpers", () => {
    assert.deepEqual(collectVisitMethodNames(SampleVisitor), ["visitProgram", "visitExpression"]);
});

void test("collectPrototypeMethodNames omits constructors", () => {
    const names = collectPrototypeMethodNames(createBaseCtor.prototype);
    assert.deepEqual(names, ["custom"]);
});

void test("deriveListenerMethodNames transforms visit names", () => {
    assert.deepEqual(deriveListenerMethodNames(["visitProgram", "visitExpression"]), [
        "enterProgram",
        "exitProgram",
        "enterExpression",
        "exitExpression"
    ]);
});

void test("definePrototypeMethods attaches generated methods", () => {
    const target = {};
    definePrototypeMethods(target, ["alpha", "beta"], (name) => () => name);

    assert.equal((target as any).alpha(), "alpha");
    assert.equal((target as any).beta(), "beta");
});

void test("createWrapperSymbols produces stable symbol keys", () => {
    const one = createWrapperSymbols("Example");
    const two = createWrapperSymbols("Example");

    assert.equal(one.instance, two.instance);
    assert.equal(one.patchFlag, two.patchFlag);
});

void test("ensureHasInstancePatched recognises marker decorated instances", () => {
    const Base = WrapperBase;
    const { instance, patchFlag } = createWrapperSymbols("ExampleBase");
    ensureHasInstancePatched(Base, {
        markerSymbol: instance,
        patchFlagSymbol: patchFlag
    });

    const wrapper = { [instance]: true };

    assert.equal(wrapper instanceof Base, true);
    assert.equal(Base[patchFlag], true);
});
