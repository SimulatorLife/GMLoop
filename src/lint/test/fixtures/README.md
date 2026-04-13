# Lint Test Fixtures

The fixture files in this directory represent the **target state** and **expected behavior** of the linter.

Treat these as **golden fixtures**:

- Do **not** edit fixture `.gml` content to make failing tests pass.
- Do **not** disable, skip, or weaken tests that assert fixture behavior.
- Do **not** 're-generate' fixture expectations to match linter behavior; always update the linter's logic to match the fixture expectations.
- Update linter logic and tests first, then regenerate/adjust fixture expectations only when intentionally changing expected behavior.

This directory follows a test-driven workflow: fixtures document what the linter should do, and implementation must conform to that expected result.

Each fixture directory must include `gmloop.json`. The file can select a preset
via `lintRuleset` (`recommended`, `feather`, or `performance`) and/or explicitly
enable the rule(s) under test via `lintRules`, then identify the fixture kind:

```json
{
    "fixture": {
        "kind": "lint",
        "assertion": "transform"
    },
    "lintRules": {
        "gml/rule-name-under-test": "error"
    }
}
```

When both `lintRuleset` and `lintRules` are present, explicit `lintRules`
entries override the selected ruleset.

Feather fixtures use the `feather/` namespace:

```json
{
    "fixture": {
        "kind": "lint",
        "assertion": "transform"
    },
    "lintRules": {
        "feather/gm1000": "error"
    }
}
```

Idempotent fixtures should omit `expected.gml` and use `"assertion": "idempotent"`.
