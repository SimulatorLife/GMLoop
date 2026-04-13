# Format Test Fixtures

The fixture files in this directory represent the **target state** and **expected behavior** of the formatter.

Treat these as **golden fixtures**:

- Do **not** edit fixture `.gml` content to make failing tests pass.
- Do **not** disable, skip, or weaken tests that assert fixture behavior.
- Do **not** 're-generate' fixture expectations to match formatter behavior; always update the formatter's logic to match the fixture expectations.
- Update formatter logic and tests first, then regenerate/adjust fixture expectations only when intentionally changing expected behavior.

This directory follows a test-driven workflow: fixtures document what the formatter should do, and implementation must conform to that expected result.

Each fixture now uses directory-per-case layout:

- `input.gml`
- optional `expected.gml`
- `gmloop.json`

`gmloop.json` must include:

```json
{
    "fixture": {
        "kind": "format",
        "assertion": "transform"
    }
}
```

Standalone idempotence cases should use `"assertion": "idempotent"` and omit `expected.gml`.
