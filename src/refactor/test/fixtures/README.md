# Refactor Test Fixtures

Refactor fixtures use project-tree cases rather than single files.

Each case directory must include:

- `project/`
- `expected/`
- `gmloop.json`

Example:

```json
{
    "refactor": {
        "codemods": {
            "loopLengthHoisting": {}
        }
    },
    "fixture": {
        "kind": "refactor",
        "assertion": "project-tree"
    }
}
```

Current fixture cases include:

- `loop-length-hoisting-basic`: verifies loop length hoisting rewrites in a single script.
- `naming-convention-cross-file`: verifies naming-convention codemods perform cross-file function renames across a multi-file project tree.

Do not edit fixture `.gml` contents to make a failing test pass. Update refactor logic or tests first.
