---
name: parser-antlr-gml
description: Use this skill when working on the GML parser workspace, ANTLR grammar, tokenization, parse errors, AST construction, source locations, or strict GameMaker Language syntax adherence.
---

# Parser ANTLR GML Skill

## Purpose

Use this skill when an agent is changing the parser workspace or parser-adjacent behavior for GameMaker Language.

The parser target state is a strict, replaceable GML front end:

- tokenizes GML accurately
- parses the real GameMaker language rather than a convenient subset
- constructs a stable AST contract
- records precise source locations
- reports useful syntax errors
- avoids formatting, lint, semantic, refactor, and code-generation ownership

This skill is target-state oriented. Do not preserve current parser structure just because it exists if that structure conflicts with the architecture, typing, performance, or GameMaker adherence goals.

## Ownership

The parser owns:

- lexer and grammar behavior
- syntax-level parse recovery
- AST construction from parsed syntax
- token, comment, range, and location capture
- syntax diagnostics and parse-result contracts

The parser does not own:

- formatting output
- lint diagnostics or autofixes
- semantic symbol resolution
- project indexing
- codemod planning
- transpilation or JavaScript emission
- UI or MCP presentation behavior

If a change requires semantic knowledge, place the capability in the semantic, lint, refactor, or transpiler workspace instead of teaching the parser to guess meaning.

## Working Approach

Before editing:

1. Confirm the relevant GameMaker syntax from the manual, runtime behavior, or existing golden fixtures.
2. Search for existing parser, AST, core, lint, format, and semantic handling of the construct.
3. Identify whether the change is syntax ownership or belongs to another workspace.
4. Add focused tests that lock in accepted syntax, rejected syntax, tokens, locations, comments, and error behavior as needed.

Implementation should:

- keep grammar changes minimal and explicit
- isolate hand-authored code from generated ANTLR output
- never edit generated parser files directly
- keep AST construction deterministic and strongly typed
- use static top-level TypeScript imports only
- preserve NodeNext ESM import specifiers with `.js`
- keep parser output independent of downstream formatter or linter needs

## AST Contract

Parser output should be stable enough that downstream workspaces can treat the parser as replaceable.

- AST nodes must model GML syntax precisely.
- Node names should describe the language concept, not the parser rule accident.
- Ranges use UTF-16 code-unit offsets when exposed to ESLint-compatible consumers.
- Locations should be complete, deterministic, and tested for constructs that are easy to misplace.
- Comments and tokens should preserve enough information for formatter and lint consumers without forcing parser ownership of their policies.
- Malformed input should produce a clear parse failure contract rather than uncaught internal exceptions.

## GameMaker Adherence

Prefer strict GameMaker behavior over generic JavaScript, TypeScript, or ANTLR convenience.

- Do not add configurable syntax modes for hypothetical dialects.
- Do not support custom GML file extensions.
- Do not silently accept syntax that GameMaker rejects unless the parser has an explicit recovery path.
- Do not loosen syntax to make formatter or linter behavior easier.
- Use established libraries where they materially improve correctness or maintainability, but keep the parser's public contract GML-specific.

## Generated Code Rules

- Do not edit generated files in `src/parser/generated`.
- Move required custom behavior into subclasses, visitors, builders, adapters, or other hand-authored TypeScript files.
- Regenerate parser artifacts through the repository's ANTLR build path when grammar changes require it.
- Treat generated output as disposable build product.

## Testing Expectations

Add or update tests when parser behavior changes.

- Use unit tests for grammar edge cases, AST shapes, tokens, comments, and error reporting.
- Use integration tests when downstream parse consumers are affected.
- Do not modify golden `.gml` fixtures unless the user explicitly permits it.
- Prefer small synthetic source strings in `.test.ts` files for new parser behavior.
- Include failure cases for invalid syntax when the behavior is part of the contract.

## Checklist

Before finishing parser work, verify:

1. The parser still owns only syntax and AST construction.
2. Generated files were not manually edited.
3. New behavior matches GameMaker rather than a convenient approximation.
4. AST, token, comment, range, and location contracts are preserved.
5. Tests cover the changed syntax and likely failure modes.
6. Downstream workspaces do not need parser internals to consume the result.

## Prohibited Patterns

- Editing generated ANTLR output directly.
- Adding parser options for syntax that GameMaker itself does not configure.
- Adding formatter, lint, semantic, refactor, or transpiler policy to parser code.
- Adding compatibility wrappers for old parser APIs.
- Using dynamic imports or `require()` in TypeScript source.
- Introducing broad `any`, broad `unknown`, or non-null assertions to bypass parser typing.
