# GML Transpiler Module

This package implements the GML → JavaScript transpiler for the GMLoop toolchain. The transpiler converts GML source code into JavaScript that can be executed in the runtime wrapper for hot-reload functionality.

## Ownership Boundaries

- The transpiler may consume semantic classification data from `@gmloop/semantic`.
- It does **not** own refactor/rename planning and should not depend on `@gmloop/refactor`.
- Refactor operations remain in the refactor engine and integration layer (CLI).

## Architecture

The transpiler consists of three main components:

### GmlTranspiler

The main transpiler class that orchestrates the transpilation process:

```javascript
import { createTranspiler } from "gamemaker-language-transpiler";

const transpiler = createTranspiler();

// Transpile a GML script to a patch object
const patch = await transpiler.transpileScript({
    sourceText: "x = 1 + 2",
    symbolId: "gml/script/my_script"
});

// Result:
// {
//   kind: "script",
//   id: "gml/script/my_script",
//   js_body: "x = (1 + 2);",
//   sourceText: "x = 1 + 2",
//   version: 1730702400000
// }
```

### GmlEmitter

The code emitter that walks the GML AST and generates JavaScript:

```javascript
import { emitJavaScript } from "gamemaker-language-transpiler/src/emitter.js";

const ast = parser.parse();
const jsCode = emitJavaScript(ast);
```

### Semantic Analysis Integration

The transpiler integrates with the `@gmloop/semantic` package to provide accurate identifier and function call classification:

```javascript
import { createSemanticOracle } from "gamemaker-language-transpiler";

// Create an oracle with built-in function knowledge
const oracle = createSemanticOracle({
    scriptNames: new Set(["scr_player_move", "scr_enemy_ai"])
});

// Use it with the emitter for improved code generation
import { GmlToJsEmitter } from "gamemaker-language-transpiler";
const emitter = new GmlToJsEmitter(oracle);

const jsCode = emitter.emit(ast);
```

The semantic oracle provides:

- **Built-in function recognition**: Automatically recognizes all GameMaker built-in functions from manual metadata
- **Script call classification**: Routes script calls through the runtime wrapper for hot reload support
- **Global variable handling**: Properly prefixes global variables with `global.`
- **SCIP symbol generation**: Generates qualified symbols for dependency tracking and cross-referencing

## Features

### Current Implementation

- ✅ Number, string, and boolean literals
- ✅ Identifiers with semantic classification
- ✅ Binary expressions (+, -, \*, /, etc.)
- ✅ GML operator mapping (div → /, mod → %, and → &&, or → ||, etc.)
- ✅ Strict equality conversion (== → ===, != → !==)
- ✅ Assignment expressions
- ✅ Compound assignment operators (+=, -=, \*=, /=, %=, &=, |=, ^=, <<=, >>=)
- ✅ Basic statements
- ✅ Array indexing (arr[0], matrix[i][j])
- ✅ Property access (obj.prop, nested.property.access)
- ✅ Function calls (func(), func(arg1, arg2))
- ✅ Variable declarations (var x = 10, y = 20)
- ✅ Function declarations (function myFunc(a, b) { ... })
- ✅ Control flow statements:
    - ✅ if/else statements (including else-if chains)
    - ✅ for loops
    - ✅ while loops
    - ✅ do-until loops (converted to do-while with negated condition)
    - ✅ switch statements with case and default
- ✅ Loop control:
    - ✅ break statements
    - ✅ continue statements
- ✅ repeat loops (converted to for loops with countdown)
- ✅ return statements (with and without values)
- ✅ Parenthesized expressions
- ✅ Block statements
- ✅ Nested control flow structures
- ✅ Array literals ([1, 2, 3])
- ✅ Struct literals ({a: 1, b: 2}) mapped to JavaScript object literals
- ✅ Ternary expressions (a ? b : c)
- ✅ Error handling:
    - ✅ throw statements
    - ✅ try-catch blocks
    - ✅ try-finally blocks
    - ✅ try-catch-finally blocks
- ✅ Built-in function mapping:
    - ✅ Mathematical functions: abs, round, floor, ceil, sqrt, sqr, power, exp, ln, log2, log10
    - ✅ Trigonometric functions: sin, cos, tan, arcsin, arccos, arctan, arctan2
    - ✅ Angle conversion: degtorad, radtodeg
    - ✅ Utility functions: min, max, sign, clamp, point_distance, lerp, median, mean
    - ✅ Random functions: random, random_range, irandom, irandom_range, choose
    - ✅ String functions:
        - ✅ Basic operations: string_length, string_char_at, string_ord_at, string_byte_at, string_byte_length
        - ✅ Searching: string_pos, string_last_pos
        - ✅ Manipulation: string_copy, string_delete, string_insert, string_replace, string_replace_all
        - ✅ Case conversion: string_upper, string_lower
        - ✅ Utility: string_repeat, string_count
        - ✅ Filtering: string_letters, string_digits, string_lettersdigits
        - ✅ Conversion: chr, ansi_char, ord, real, string
        - ✅ Formatting: string_format
- ✅ Semantic analysis integration:
    - ✅ Built-in function recognition via GameMaker manual metadata
    - ✅ Script call classification and runtime wrapper routing
    - ✅ Global variable identification and prefixing
    - ✅ SCIP symbol generation for dependency tracking
- ✅ Object-oriented features:
    - ✅ Constructor calls with `new` keyword (new Vector2(x, y))
    - ✅ Delete operator for removing struct members (delete obj.prop)
- ✅ Event transpilation:
    - ✅ `transpileEvent()` – produces an `EventPatch` for GML object events
    - ✅ `EventContextOracle` – treats undeclared identifiers as `self.<name>` in event scope
    - ✅ `collectLocalVariables()` – pre-collects `var`-declared locals to avoid misclassifying them as instance fields

### Planned Features

- [x] `with` statement lowering
- [x] Built-in function mapping (expanded to 60+ functions including comprehensive string, math, and random number support)
- [x] Semantic oracle integration for identifier classification
- [x] Script call indirection through runtime wrapper
- [x] Compound assignment operators (+=, -=, \*=, /=, %=, &=, |=, ^=, <<=, >>=)
- [x] Event transpilation with `transpileEvent()` and `EventContextOracle`
- [ ] Additional built-in function mapping (array functions, data structure functions, drawing functions)

## Operator Mapping

The transpiler maps GML-specific operators to their JavaScript equivalents:

| GML Operator | JavaScript Equivalent |
| ------------ | --------------------- | --- | --- |
| `div`        | `/`                   |
| `mod`        | `%`                   |
| `and`        | `&&`                  |
| `or`         | `                     |     | `   |
| `xor`        | `^`                   |
| `==`         | `===`                 |
| `!=`         | `!==`                 |

## Integration

The transpiler integrates with the broader hot-reload pipeline:

1. **Parser** (`gamemaker-language-parser`) - Parses GML source into an AST
2. **Semantic** (`gamemaker-language-semantic`) - (Future) Provides scope and type information
3. **Transpiler** (this module) - Converts AST to JavaScript
4. **Runtime Wrapper** (`gamemaker-language-runtime-wrapper`) - Applies patches to the running game

## Testing

Run tests with:

```bash
pnpm test
```

The test suite includes:

- Literal value handling
- Operator mapping verification
- Expression generation
- Error handling
- Patch object creation
- Performance-focused micro-benchmarks under `test/performance/`

## Design Principles

- **Minimal Changes**: Generate JavaScript that closely matches GML semantics
- **Incremental**: Build features progressively with comprehensive tests
- **Runtime Compatibility**: Ensure output works with the runtime wrapper expectations
- **Testable**: Lock in behavior with tests for every feature

## Status

The module is currently in **active development**. It provides basic expression transpilation and serves as the foundation for the full GML → JavaScript pipeline described in `docs/semantic-scope-plan.md`.

## References

- [Semantic Scope Plan](../../docs/semantic-scope-plan.md) - Detailed transpiler architecture
- [Hot Reload Architecture](../../docs/hot-reload.md) - Hot-reload workflow
- [Runtime Wrapper](../runtime-wrapper/) - JavaScript runtime integration
