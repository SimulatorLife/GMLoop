import assert from "node:assert/strict";
import test from "node:test";

import { ensureStatementTerminated, isStatementTerminated } from "../src/emitter/statement-termination-policy.js";

void test("isStatementTerminated returns false for unterminated expression statements", () => {
    assert.equal(isStatementTerminated("foo(bar)"), false);
});

void test("isStatementTerminated returns true for existing statement terminators", () => {
    assert.equal(isStatementTerminated("foo();"), true);
    assert.equal(isStatementTerminated("foo();   "), true);
});

void test("isStatementTerminated returns true for control flow prefixes", () => {
    assert.equal(isStatementTerminated("    if (ready) { doThing(); }"), true);
});

void test("isStatementTerminated returns false for empty string", () => {
    assert.equal(isStatementTerminated(""), false);
});

void test("append semicolon when policy requires terminator", () => {
    assert.equal(ensureStatementTerminated("foo(bar)"), "foo(bar);");
});

void test("keep existing terminators unchanged", () => {
    assert.equal(ensureStatementTerminated("foo();"), "foo();");
    assert.equal(ensureStatementTerminated("foo();   "), "foo();   ");
    assert.equal(ensureStatementTerminated("if (ready) { doThing(); }"), "if (ready) { doThing(); }");
    assert.equal(ensureStatementTerminated("{\n  doThing();\n}"), "{\n  doThing();\n}");
    assert.equal(ensureStatementTerminated("{\n  doThing();\n}   "), "{\n  doThing();\n}   ");
});
