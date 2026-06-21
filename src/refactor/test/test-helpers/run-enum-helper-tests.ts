/**
 * Shared test contract for enums produced by `createEnumHelpers` in
 * `@gmloop/refactor/src/types.ts`.
 *
 * Every `createEnumHelpers`-backed enum in the refactor workspace exposes the
 * same surface (`is`, `parse`, `require`) with identical observable behaviour,
 * so the boilerplate tests that prove that contract were duplicated across
 * four near-identical files (`symbol-kind.test.ts`, `conflict-type.test.ts`,
 * `occurrence-kind.test.ts`, `conflict-severity.test.ts`).
 *
 * `runEnumHelperTests` runs the shared assertions once per enum by parameterising
 * on a small {@link EnumHelperContract} describing the enum's values, names,
 * and helper functions. Individual enum test files should call it with their
 * own contract and may add enum-specific assertions afterwards.
 */

import assert from "node:assert/strict";
import test from "node:test";

/**
 * Description of one enum produced by `createEnumHelpers`.
 *
 * `enumName` doubles as the prefix for the helper function names so the test
 * titles line up with the real exported identifiers (`is` + `enumName`,
 * `parse` + `enumName`, `require` + `enumName`). `typeName` is the human
 * label used inside error messages (e.g. "symbol kind") and in the natural
 * language parts of the test titles.
 */
export interface EnumHelperContract<TValue extends string> {
    enumName: string;
    typeName: string;
    typeNamePlural?: string;
    enum: Readonly<Record<string, string>>;
    validValues: ReadonlyArray<TValue>;
    invalidValues: ReadonlyArray<unknown>;
    is: (value: unknown) => boolean;
    parse: (value: unknown) => TValue | null;
    require: (value: unknown, context?: string) => TValue;
}

const STRINGIFIED_INVALID_VALUES = new Set<unknown>([null, undefined, 123, {}, []]);

/**
 * Runs the common `createEnumHelpers` contract tests for a single enum.
 *
 * The shared suite covers: enum value membership, frozen-ness, case-sensitive
 * matching, the `is` / `parse` / `require` happy paths, the rejection paths
 * for invalid strings and non-string inputs, and the contextual metadata the
 * error messages embed (context tag, received value, valid-values list).
 *
 * @param contract - The enum description; see {@link EnumHelperContract}.
 */
export function runEnumHelperTests<TValue extends string>(contract: EnumHelperContract<TValue>): void {
    const {
        enumName,
        typeName,
        typeNamePlural = `${typeName}s`,
        enum: enumObj,
        validValues,
        invalidValues,
        is,
        parse,
        require: requireFn
    } = contract;

    const isFunctionName = `is${enumName}`;
    const parseFunctionName = `parse${enumName}`;
    const requireFunctionName = `require${enumName}`;
    const valueTypeName = `${enumName}Value`;
    const validValuesDescription = validValues.join(", ");

    const firstInvalidString = invalidValues.find((value) => typeof value === "string");
    if (typeof firstInvalidString !== "string") {
        throw new TypeError(
            `runEnumHelperTests requires at least one string in invalidValues for ${enumName} so the ` +
                `"throws TypeError for invalid value" assertion can match against the printed input.`
        );
    }

    void test(`${enumName} enum contains expected values`, () => {
        for (const expected of validValues) {
            assert.ok(Object.values(enumObj).includes(expected), `${enumName} should contain ${expected}`);
        }
    });

    void test(`${enumName} enum is frozen`, () => {
        assert.ok(Object.isFrozen(enumObj), `${enumName} must be frozen to keep the constants immutable`);
    });

    void test(`${isFunctionName} returns true for valid ${typeNamePlural}`, () => {
        for (const value of validValues) {
            assert.ok(is(value), `${JSON.stringify(value)} should be a valid ${typeName}`);
        }
    });

    void test(`${isFunctionName} returns false for invalid ${typeNamePlural}`, () => {
        for (const value of invalidValues) {
            assert.ok(!is(value), `${JSON.stringify(value)} must not be a valid ${typeName}`);
        }
    });

    void test(`${isFunctionName} is case-sensitive`, () => {
        for (const value of validValues) {
            const upperCase = value.toUpperCase();
            if (upperCase === value) {
                continue;
            }
            assert.ok(!is(upperCase), `${upperCase} must be rejected (case-sensitive matching)`);
            assert.ok(
                !is(value.charAt(0) + value.slice(1).toLowerCase().slice(1)),
                `Title-cased value must be rejected`
            );
        }
    });

    void test(`${parseFunctionName} returns valid ${typeName} for valid input`, () => {
        for (const value of validValues) {
            assert.equal(parse(value), value);
        }
    });

    void test(`${parseFunctionName} returns null for invalid input`, () => {
        for (const value of invalidValues) {
            assert.equal(parse(value), null, `parsing ${JSON.stringify(value)} must return null`);
        }
    });

    void test(`${requireFunctionName} returns valid ${typeName} for valid input`, () => {
        for (const value of validValues) {
            assert.equal(requireFn(value), value);
        }
    });

    void test(`${requireFunctionName} throws TypeError for invalid ${typeName}`, () => {
        assert.throws(() => requireFn(firstInvalidString), {
            name: "TypeError",
            message: new RegExp(`Invalid ${typeName}.*Must be one of: ${escapeRegex(validValuesDescription)}`)
        });
    });

    void test(`${requireFunctionName} throws TypeError for non-string input`, () => {
        for (const value of invalidValues) {
            if (STRINGIFIED_INVALID_VALUES.has(value)) {
                assert.throws(() => requireFn(value), {
                    name: "TypeError",
                    message: new RegExp(`Invalid ${typeName}`)
                });
            }
        }
    });

    void test(`${requireFunctionName} includes context in error message`, () => {
        assert.throws(() => requireFn(firstInvalidString, "validation context"), {
            name: "TypeError",
            message: /in validation context/
        });
    });

    void test(`${requireFunctionName} error message includes received value`, () => {
        assert.throws(() => requireFn(firstInvalidString), {
            name: "TypeError",
            message: new RegExp(`"${escapeRegex(firstInvalidString)}"`)
        });
    });

    void test(`${valueTypeName} type accepts all valid ${typeNamePlural}`, () => {
        const arr: Array<TValue> = [...validValues];
        assert.equal(arr.length, validValues.length);
    });

    void test(`${parseFunctionName} can be used in control flow narrowing`, () => {
        const raw = validValues[0];
        const parsed = parse(raw);

        if (parsed !== null) {
            const _typeCheck: TValue = parsed;
            assert.ok(_typeCheck);
        }
    });

    void test(`${isFunctionName} can be used as type guard`, () => {
        const raw: TValue = validValues[0];

        if (is(raw)) {
            const _typeCheck: TValue = raw;
            assert.ok(_typeCheck);
        }
    });
}

/**
 * Escape characters that have special meaning inside a regular expression so
 * the generated test title regexes can be assembled safely from enum values.
 */
function escapeRegex(input: string): string {
    return input.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
