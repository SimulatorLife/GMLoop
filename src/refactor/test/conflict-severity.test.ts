import assert from "node:assert/strict";
import test from "node:test";

import {
    ConflictSeverity,
    type ConflictSeverityValue,
    isConflictSeverity,
    parseConflictSeverity,
    requireConflictSeverity
} from "../src/types.js";

void test("ConflictSeverity enum contains expected values", () => {
    assert.equal(ConflictSeverity.ERROR, "error");
    assert.equal(ConflictSeverity.WARNING, "warning");
    assert.equal(ConflictSeverity.INFO, "info");
});

void test("ConflictSeverity enum is frozen", () => {
    assert.ok(Object.isFrozen(ConflictSeverity));
});

void test("isConflictSeverity returns true for valid severities", () => {
    assert.ok(isConflictSeverity("error"));
    assert.ok(isConflictSeverity("warning"));
    assert.ok(isConflictSeverity("info"));
});

void test("isConflictSeverity returns false for invalid severities", () => {
    assert.ok(!isConflictSeverity("fatal"));
    assert.ok(!isConflictSeverity("critical"));
    assert.ok(!isConflictSeverity("debug"));
    assert.ok(!isConflictSeverity("trace"));
    assert.ok(!isConflictSeverity(""));
    assert.ok(!isConflictSeverity(null));
    assert.ok(!isConflictSeverity(undefined));
    assert.ok(!isConflictSeverity(123));
    assert.ok(!isConflictSeverity({}));
    assert.ok(!isConflictSeverity([]));
    assert.ok(!isConflictSeverity(true));
});

void test("isConflictSeverity is case-sensitive", () => {
    assert.ok(!isConflictSeverity("ERROR"));
    assert.ok(!isConflictSeverity("Error"));
    assert.ok(!isConflictSeverity("WARNING"));
    assert.ok(!isConflictSeverity("Warning"));
    assert.ok(!isConflictSeverity("INFO"));
    assert.ok(!isConflictSeverity("Info"));
});

void test("parseConflictSeverity returns valid severity for valid input", () => {
    assert.equal(parseConflictSeverity("error"), "error");
    assert.equal(parseConflictSeverity("warning"), "warning");
    assert.equal(parseConflictSeverity("info"), "info");
});

void test("parseConflictSeverity returns null for invalid input", () => {
    assert.equal(parseConflictSeverity("fatal"), null);
    assert.equal(parseConflictSeverity("debug"), null);
    assert.equal(parseConflictSeverity(""), null);
    assert.equal(parseConflictSeverity(null), null);
    assert.equal(parseConflictSeverity(undefined), null);
    assert.equal(parseConflictSeverity(123), null);
    assert.equal(parseConflictSeverity({}), null);
    assert.equal(parseConflictSeverity([]), null);
});

void test("requireConflictSeverity returns valid severity for valid input", () => {
    assert.equal(requireConflictSeverity("error"), "error");
    assert.equal(requireConflictSeverity("warning"), "warning");
    assert.equal(requireConflictSeverity("info"), "info");
});

void test("requireConflictSeverity throws TypeError for invalid severity", () => {
    assert.throws(() => requireConflictSeverity("fatal"), {
        name: "TypeError",
        message: /Invalid conflict severity.*Must be one of: error, warning, info/
    });
});

void test("requireConflictSeverity throws TypeError for non-string input", () => {
    assert.throws(() => requireConflictSeverity(123), {
        name: "TypeError",
        message: /Invalid conflict severity/
    });
    assert.throws(() => requireConflictSeverity(null), {
        name: "TypeError",
        message: /Invalid conflict severity/
    });
    assert.throws(() => requireConflictSeverity(undefined), {
        name: "TypeError",
        message: /Invalid conflict severity/
    });
});

void test("requireConflictSeverity includes context in error message", () => {
    assert.throws(() => requireConflictSeverity("fatal", "rename validation"), {
        name: "TypeError",
        message: /in rename validation/
    });
});

void test("requireConflictSeverity error message includes received value", () => {
    assert.throws(() => requireConflictSeverity("fatal"), {
        name: "TypeError",
        message: /"fatal"/
    });
});

void test("ConflictSeverityValue type accepts all valid severities", () => {
    const severities: Array<ConflictSeverityValue> = [
        ConflictSeverity.ERROR,
        ConflictSeverity.WARNING,
        ConflictSeverity.INFO
    ];
    assert.equal(severities.length, 3);
});

void test("parseConflictSeverity can be used in control flow narrowing", () => {
    const rawSeverity: string = "warning";
    const severity = parseConflictSeverity(rawSeverity);

    if (severity !== null) {
        const _typeCheck: ConflictSeverityValue = severity;
        assert.ok(_typeCheck);
    }
});

void test("isConflictSeverity can be used as type guard", () => {
    const rawSeverity: unknown = "error";

    if (isConflictSeverity(rawSeverity)) {
        const _typeCheck: ConflictSeverityValue = rawSeverity;
        assert.ok(_typeCheck);
    }
});

void test("ConflictSeverity constants can be used in conditionals", () => {
    const severity: ConflictSeverityValue = "warning";

    if (severity === ConflictSeverity.WARNING) {
        assert.ok(true);
    } else {
        assert.fail("Should match WARNING");
    }
});

void test("ConflictSeverity rejects invalid severities with helpful error", () => {
    const invalidSeverity = "fatal";
    assert.throws(
        () => requireConflictSeverity(invalidSeverity, "test context"),
        (error: Error) => {
            assert.ok(error instanceof TypeError);
            assert.ok(error.message.includes("Invalid conflict severity"));
            assert.ok(error.message.includes('"fatal"'));
            assert.ok(error.message.includes("test context"));
            assert.ok(error.message.includes("Must be one of: error, warning, info"));
            return true;
        }
    );
});

void test("Invalid strings fail fast with requireConflictSeverity", () => {
    // Regression: prior to typed centralization, raw literals like "warn" or "fatal"
    // would silently fall through the `=== "warning"` check and be misclassified.
    // The typed enum now rejects any string not in {error, warning, info}.
    const invalidStrings = ["warn", "fatal", "critical", "debug", "ERROR", "Warning", "Info", "notice"];

    for (const invalid of invalidStrings) {
        assert.throws(
            () => requireConflictSeverity(invalid),
            (error: Error) => {
                assert.ok(error instanceof TypeError);
                assert.ok(error.message.includes("Invalid conflict severity"));
                assert.ok(error.message.includes(JSON.stringify(invalid)));
                return true;
            },
            `Expected requireConflictSeverity to throw on invalid input: ${invalid}`
        );
    }
});

void test("Valid severities keep working after typed centralization", () => {
    // Regression: the typed constants must produce the same string values that
    // the previous stringly-typed branches compared against, so existing
    // equality checks using the constants continue to behave correctly.
    assert.equal(ConflictSeverity.ERROR === "error", true);
    assert.equal(ConflictSeverity.WARNING === "warning", true);
    assert.equal(ConflictSeverity.INFO === "info", true);

    // Round-tripping through parse keeps the canonical string form.
    assert.equal(parseConflictSeverity(ConflictSeverity.ERROR), ConflictSeverity.ERROR);
    assert.equal(parseConflictSeverity(ConflictSeverity.WARNING), ConflictSeverity.WARNING);
    assert.equal(parseConflictSeverity(ConflictSeverity.INFO), ConflictSeverity.INFO);

    // require returns the canonical form for valid input.
    assert.equal(requireConflictSeverity(ConflictSeverity.ERROR), ConflictSeverity.ERROR);
    assert.equal(requireConflictSeverity(ConflictSeverity.WARNING), ConflictSeverity.WARNING);
    assert.equal(requireConflictSeverity(ConflictSeverity.INFO), ConflictSeverity.INFO);
});
