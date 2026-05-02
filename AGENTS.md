# Agent Instructions
- **NEVER** edit files in a `dist` directory; these are compiler-generated build artifacts and must always be treated as disposable output. Any changes required to the emitted JavaScript must be made in the corresponding `.ts` source files, never in the generated `.js`, `.d.ts`, or `.map` files. The `dist` directory should always be safe to delete, fully reproducible, and regenerated exclusively through the TypeScript build process.
- Be careful not to introduce duplicate functionality; search thoroughly to confirm the behavior does not already exist elsewhere. Only when you are absolutely certain no existing workspace provides the required capability should new functionality be added, and it must be placed in the correct domain layer rather than reinventing or shadowing existing code.
- The existing integration test input and output fixtures (`test/fixtures/**/*.gml`), the parser input fixtures (`src/parser/test/**/*.gml`), and the linter's input/output auto-fix fixtures (`src/lint/test/**/*.gml`) in this project are considered golden files and **MUST NEVER BE MODIFIED UNLESS EXPLICITLY GIVEN PERMISSION**. They capture parsing behavior and the desired formatting and/or lint auto-fixing for GML code and must be preserved byte-for-byte. NEVER update or change these files, certainly not to "fix" a test failure. You may add/modify `*.test.ts` tests or adjust the way tests are executed, but **NOT** `*.gml` text fixtures.
- This repository includes a single `AGENTS.md` file at the root (this file); there are no nested variants elsewhere in the tree.
- Before implementing a task, inspect the repository's available skills under `skills/**` and apply the skill or skills that best match the request. When multiple skills apply, prefer the most specific relevant one. If generic agent defaults conflict with a repository skill, follow the repository skill.
- Do **NOT** modify agent-specific files such as `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.gemini/**`, `.qwen/**`, `.aiderignore`, `.codex/**` unless the user explicitly asks you to do so.
- Do **NOT** modify the `AGENTS.md` file under any circumstances, including discarding/reverting changes. If you see modifications to this file, assume they were made by the human developer and do **NOT** revert them.
- The `vendor/GameMaker-Manual` and `vendor/GameMaker-HTML5` directories are Git submodules that pin YoYo Games' manual and HTML5 runtime snapshots. Treat them as read-only and execute-only assets: do not edit files inside these folders, do not stage ad-hoc changes, and only update them by adjusting the submodule pointer when explicitly asked. Initialize them with `git submodule update --init --recursive` during setup if they are missing.
- Do **NOT** modify the Github Actions workflows in `.github/workflows` unless explicitly instructed to do so. When updating these files, ensure the changes are limited to the specific instructions or guidelines provided, without altering other sections.
- Do **NOT** modify the `eslint.config.js` or `.prettierrc` files unless explicitly instructed to do so. When instructed to update these files, ensure that the changes are limited to the specific instructions or guidelines provided, without altering other sections.
- Do **NOT** add legacy-support or backwards-compatibility shims to the codebase. When updating or extending the codebase, avoid reintroducing old CLI command formats, deprecated script arguments, outdated plugin options, transitional wrappers, redundant aliases, or any parallel paths meant to preserve previous behavior. Favor clean, forward-looking implementations that document breaking changes succinctly instead of maintaining compatibility code.
- Do **NOT** add standalone Node scripts outside of `src/cli/src/commands/`. Expose new tooling through the CLI so helpers remain discoverable and consistent. For any single-use/debugging/investigation scripts, you can create a temporary file in the project's root `tmp` directory (e.g., `tmp/debug-script.js`).
- Do **NOT** edit the generated files in `src/parser/generated`; any and all changes will be overwritten when the file are re-generated. The generated code is tightly coupled to ANTLR’s runtime. Even a small edit could break assumptions about rule indices, token streams, or the visitor/listener APIs. These files have had manual edits already, and that custom code needs to be exracted out and refactored such that we subclass the generated code.
- Do **NOT** use boundary-skirting import patterns such as `await import(...)`, dynamic `import()` expressions, or `require()` calls in TypeScript. All imports must be static and at the top level of the file, using standard ES module syntax. This ensures that all dependencies are clear, type-checked, and compatible with the ESM module system.
- Do **NOT** add eslint-disable or `@ts-*` comments to the codebase. If lint/type errors arise, fix them properly. If you encounter any existing eslint-disable or `@ts-*` comments, remove them and fix the underlying issues.
- Do **NOT** add or maintain `.d.ts` files alongside source in `src/` unless they are genuine ambient declarations (e.g., typing third-party globals, JS-first modules, or actionable API shims). Hand-authored declarations should live under `types/` or another dedicated ambient directory so normal TypeScript compilation treats `.d.ts` as generated artifacts rather than source, keeping the repository clean and forward-looking.
- The plugin/formatter should be opinionated and enforce a single opinionated strategy (for indentation, spacing, blank lines, etc.) – avoid adding overly-configurable options that give users too many choices or lead to inconsistent formatting. For instance, instead of multiple options to control line-length formatting (such as printWidth, wrapThreshold, maxLineLength, etc.), there should be a single `printWidth` option that governs line length. Excessive configurability leads to maintenance burden and unpredictable output.
- **ONLY** the `plugin` workspace may depend on `prettier` and related formatting packages. All other workspaces must remain free of formatting dependencies. If they require formatting-related functionality, it must be moved into and exposed by the `plugin` workspace (only the project's root `package.json` should have Prettier as a `devDependency` for formatting of *this* codebase).
- When any unrelated changes appear in the repo, ignore them and continue. Do not discard those changes; just focus on the scope of your task(s). Other agents or processes may be working on different parts of the codebase simultaneously, and their changes may be interleaved in commits or pull requests. As long as your specific task is completed correctly, you can safely ignore unrelated modifications made by others. Do not pause or delay or ask for confirmation to continue your work; focus on your assigned tasks and trust that other contributors will handle their respective areas appropriately.
- Respect the formatter/linter split contract: semantic/content rewrites belong in `@gml-modules/lint` (or refactor transactions), while `@gml-modules/plugin` remains formatter-only and layout-focused.

----

## Code Style & Quality
- Keep individual source files under ~1000 lines of executable code (excluding comments, blank lines, and imports) by splitting or moving functionality into additional files as needed, organizing related pieces into sub-directories when appropriate and exposing them through a clear, shared interface so the structure remains coherent and discoverable.
- When fixing lint/test errors/failures, your goal is **NOT** simply to perform minimal fixes that merely silence type/lint/test errors. Instead, you must drive the codebase toward a well-architected, fully typed, de-duplicated, clean, DRY and maintainable design; fix the underlying issues *properly*. You *may* introduce short-term breakage if doing so enables a clearer, more correct, and more coherent long-term structure. Structural correctness overrides temporary stability.
- When debugging issues/failures, **prioritize unit tests over debug logging**; create more targeted tests or updating existing unit tests as needed to identify/reproduce/catch issues. These unit tests can then become part of the codebase's testing suite. Console/debug logging, on the other hand, is hard to interpret and slow to iterate on. If a function is too large to test properly, then it likely needs to be refactored/re-organized/split up first to allow for proper testing.
- When considering adding new dependencies, prefer dependencies that are already in use within the monorepo to minimize bloat.
- Code must be organized by domain, not by generic utility patterns: New functionality must be placed in domain-appropriate directories (e.g., `src/semantic/src/analyze/…`, `src/transpiler/src/emit/…`, `src/runtime-wrapper/src/bridge/…`), never into catch-all filenames such as `utils.ts`, `helpers.ts`, or `common.ts`. A workspace's public exports must present a single cohesive conceptual responsibility, and unrelated helpers must be split into their own domain-specific files instead of accumulating in shared “miscellaneous” locations.
- Use named scopes for all inter-workspace imports, always referencing workspaces by their declared name rather than using relative paths, and ensure that each workspace re-exports its public API at the top level so consumers import only from the workspace root (e.g., use `@gml-modules/core` instead of deep paths like `"../../../src/core/src/ast/comments.js"`); this rule also applies in `package.json`, where inter-workspace dependencies must always be listed by workspace name rather than filesystem paths.
- Do **NOT** create re-export wrappers (e.g. importing functionality from a workspace solely to re-export it). Each workspace should only export its own unique public API rather than acting as a pass-through for other files or packages. Don't create “pass-through” file/shims/placeholders/wrappers that simply import symbols from another workspace and re-export them; files should always import the specific functions or values they need directly at the point of use rather than acting as proxy exporters, ensuring each workspace exposes only its own public API and avoiding unnecessary indirection. If you encounter an existing pass-through file, remove it and update callers to import the required symbols directly.
- This codebase does **NOT** allow `.mjs`, `.cjs`. or `.js` as source files **except for in vendor-code directories and generated code**; all code must be authored as **typescript** (`.ts`) files, and packages should rely on `"type": "module"` to enable ESM behavior consistently throughout the monorepo. If you encounter existing `.mjs`, `.cjs`, or `.js` files, refactor them to `.ts` and adjust imports/exports accordingly. No custom file extensions (e.g., .gmlx, .gmlext, .foo) are permitted; the system recognizes `.ts` for source and `.gml` for GameMaker language files.
- Each workspace and major internal directory **MUST** include an `index.ts` file that serves exclusively as the export surface for that directory; `index.ts` files should contain only exports, no runtime logic, and must re-export all intended public functionality so that other external workspaces/consumers import solely from another workspace's root (e.g., `@gml-modules/core`) rather than deep relative paths or subdirectories. Every `index.ts` file must consist exclusively of imports and exports and must re-export the public symbols for its directory, never act as a place for runtime logic, helper functions, initialization logic, computations, or side-effects. For each workspace root, its top-level `index.ts` must export exactly one named namespace (e.g., `export * as Transpiler from "./src/index.ts`"; or `export const Semantic = Object.freeze({ ... });`) and must not contain default exports. However, internal implementation files *within a single workspace* must never import its own `index.ts` namespace layers; internal code must use direct relative imports only. The namespace exports exist solely for the workspace's consumers, not for internal use.
- Use a consistent directory structure across the monorepo, where each workspace contains a top-level `package.json`, a top-level `index.ts`, a top-level `tsconfig.json` and separate `src/` and `test/` directories; all implementation code must reside in `src/` and all tests must reside in `test/`.
- Avoid legacy-behavior support; always implement the current, forward-looking design without adding compatibility layers or transitional code.
- When exporting a workspace's public API, use named wildcard exports to provide clear namespace grouping (e.g., `export * as AST from "./ast"; export * as Parser from "./parser"; export * as Transforms from "./transforms";`).
- When importing from another top-level workspace, always import the workspace's **single exported namespace** which represents its **public API** (e.g., `import * as Core from "@gml-modules/core"`), and **do not destructure** that namespace into individual symbols; external consumers must always call functions or access exports via the namespace object (e.g., `Core.toMutableArray(...)`). Destructuring is allowed only for internal imports within the same workspace, where direct relative paths **MUST** be used instead of importing through the workspace's public namespace.
- Avoid using optional properties (e.g. `(foo?: T)`, `T | undefined`) and utility types such as `Partial<T>` **unless the data is truly optional or incomplete by design** (e.g., API responses or incremental builders). Do not use optionality as a shortcut to silence type errors, to mask missing initialization, or to represent values that are logically required at runtime. Optionality must reflect real domain behavior, not developer convenience. If only some fields are required, define a narrower type instead of applying broad `Partial<T>` to entire objects, and never rely on non-null assertions (!) to bypass proper typing — they are a strong indicator that the value should not have been optional in the first place. Likewise, do not use type `any` or `unknown` to silence type errors or to bypass proper typing—doing so hides real bugs and defeats the purpose of TypeScript in this codebase. If a value is difficult to type, create a more precise type, narrow the definition, or explicitly model the unknown shape with `unknown` plus safe refinement logic.
- **Use meaningful function names over brevity**. Avoid overly generic verbs like `handle`, `process`, or `doWork`. Function names should clearly reflect their domain and operation, e.g., `attachTrailingCommentsToStatement`, `normalizeLineBreaks`, `resolveImportSpecifiers`.
- New public/exported functions and types must have TSDoc comments and corresponding tests mirrored under `test/` with matching directory structure.
- Do not embed source code, HTML, CSS, or other standalone assets inside string literals or template strings. Avoid functions that “render” entire scripts/styles/documents as strings; instead, place the content in proper standalone files such as `.ts`, `.html`, or `.css`, and load/import them normally. Only use string-generated code where absolutely necessary for unavoidable scenarios with a clear justification.
- Dynamic inline import expressions are **BANNED** and must never be added to the codebase. Any existing ones encountered must be replaced. These include patterns such as:
  ```ts
  // Anti-pattern: inline dynamic type import
  return (node as import("./types.js").MemberIndexExpressionNode).type === "MemberIndexExpression";
  ```

  These expressions reduce readability, break the monorepo’s import-structure guarantees, encourage the use of `.js` paths in TypeScript, and circumvent type-layer boundaries.

  The target state for all type imports is that they are declared explicitly at the top of the `.ts` file using normal TypeScript import syntax and then referenced directly:
  ````ts
  // GOOD: explicit top-level type import
  import type { MemberIndexExpressionNode } from "./types.js";
  return (node as MemberIndexExpressionNode).type === "MemberIndexExpression";
  ````

----

## Workspace Ownership Boundaries (Parser / Core / Plugin)
>This section defines clear ownership boundaries between the parser, core, and plugin workspaces to ensure a clean architecture with well-defined responsibilities.

### Parser Ownership

The parser workspace *should* own:

- ✅ Tokenization (lexer)
- ✅ Grammar
- ✅ AST node construction
- ✅ Source locations
- ✅ Error recovery

The parser should **not** own:

- ❌ Formatting rules
- ❌ Traversal helpers
- ❌ Normalization passes
- ❌ Code generation
- ❌ Prettier-specific behavior

### Core Ownership

The core workspace *should* own:
- ✅ AST types/interfaces
- ✅ Node kind enums
- ✅ Structural helpers
- ✅ Traversal helpers (visitors, walkers)
- ✅ Clone / equality helpers
- ✅ Path utilities

The core workspace should **not** own:
- ❌ Parsing logic
- ❌ Formatting rules
- ❌ Printing logic
- ❌ Prettier integration

### Plugin Ownership

The plugin should handle:
- ✅ AST → AST (normalization)
- ✅ AST → AST (formatting transforms)
- ✅ AST → GML (printer)
- ✅ Prettier glue
- ✅ Formatter-only and layout-focused

The plugin *should* import:
- AST types + traversal from core
- A tiny public API from the parser, typically just ``parse(source: string): ProgramNode``

The plugin must **not** import:
- ❌ Parser internals
- ❌ Grammar rules
- ❌ Lexer logic
- ❌ Semantic/content rewrites

### Target State Summarized
- `@gml-modules/core`: Pure data model + shared utilities, AST types/interfaces, traversal helpers used by the plugin and parser to walk the AST.
- `@gml-modules/parser`: GML → AST only
- `@gml-modules/plugin`: AST → AST → GML

### The Litmus Test

This single question tells you if the architecture is clean:

>“Could I swap the entire parser implementation without touching the plugin, as long as the AST stays identical?”

If the answer is no, then:
- The parser owns too much
- The AST contract is not isolated

----

## Module structure, imports, and TypeScript / ESM strategy

This project is a TypeScript monorepo targeting Node’s native ESM loader. The key goals are:

- Source of truth lives in `*.ts` files under `src/…`
- Each workspace builds to its own `dist/` directory
- Runtime always executes built JavaScript from `dist/`
- Import paths in the emitted JavaScript are valid Node ESM specifiers
- TypeScript never needs `allowImportingTsExtensions` (so we can still emit JS)

### Source layout and build output

Each workspace lives under `src/` and has its own `tsconfig.json` that extends a shared base:

````text
src/
  core/
    src/...
    test/...
    dist/...
    tsconfig.json
    index.ts
  parser/
    src/...
    test/...
    dist/...
    tsconfig.json
    index.ts
  …etc…
````

The shared [./tsconfig.base.json](./tsconfig.base.json) defines common compiler options (`ES2022`, `moduleResolution = NodeNext`, `declaration: true`, `sourceMap: true`, etc.), but does not set `outDir` (each workspace sets its own).

Each workspace’s `tsconfig.json` is responsible for its own output location, for example:
````json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"],
  "exclude": ["node_modules", "**/generated/**"]
}
````

The build pipeline runs tsc per workspace and emits:

- `dist/**/*.js` – runnable JavaScript
- `dist/**/*.d.ts` – type declarations
- `dist/**/*.js.map` / `dist/**/*.d.ts.map` – source maps (for debugging and tooling)

Tests and downstream consumers always run against the dist/**.js output, not the TypeScript sources.

### Import style inside TypeScript

All internal imports in `*.ts` files use Node-valid ESM specifiers. The pattern is:

- Use `.js` extensions in import specifiers, even though the actual source files are .ts.
- Let TypeScript (with `moduleResolution: "NodeNext"`) resolve those `.js` specifiers to the corresponding `.ts` sources at compile time.

Example inside a workspace:
````ts
// GOOD: .js in the specifier, .ts on disk
import { parseNode } from "./parse-node.js";
import { normalizeComments } from "../comments/comments.js";
````

On disk, the source files are:
````text
src/ast/parse-node.ts
src/comments/comments.ts
````

TypeScript understands that `./parse-node.js` should bind to `parse-node.ts` during compilation, then re-emits the same import `./parse-node.js` in the compiled JS. This keeps the emitted JavaScript compatible with Node’s ESM loader.

Do **NOT** import using `.ts` extensions (e.g. `import "./parse-node.ts"`).
This would require `allowImportingTsExtensions`, which in turn forces `noEmit` or `emitDeclarationOnly` and would break JS emit for our build.

Do **NOT** import from `dist/` inside source files: All source-level imports stay inside `src/` and use relative paths or specifiers.

### Cross-workspace imports

Each workspace is a proper Node package with its own `package.json`, for example:

````json
{
  "name": "@gml-modules/core",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
````

The public API of a workspace is exposed via a barrel file, typically `src/index.ts`, which compiles to `dist/index.js` and `dist/index.d.ts`.

Other workspaces import using a workspace's name, not from `dist/` paths:

````ts
// In another workspace that depends on @gml-modules/core:
import { Core } from "@gml-modules/core";
````

This keeps boundaries clean:
- Source code never uses `../core/dist/...` imports.
- Consumers and tests interact with each workspace through its public API.

### Module resolution strategy

Codebase uses:

```json
"type": "module",
"module": "NodeNext",
"moduleResolution": "NodeNext"
```

This combination instructs TypeScript to:

- Treat `.js` specifiers in imports as ESM entry points.
- Resolve them to .ts sources in the `src/` tree (when compiling).
- Preserve the `.js` specifiers in the emitted JavaScript so Node can run it directly.

We do not use `allowImportingTsExtensions`, because TypeScript currently only allows that flag when noEmit or emitDeclarationOnly is set. Our build relies on tsc emitting runnable `.js`, so this repo follows the “TS sources with `.js` specifiers” pattern instead.

### File extensions and custom formats

The parser and tooling are intentionally opinionated about file types:

- Source code: `*.ts`
- Build output: `*.js`, `*.d.ts`, `*.map`
- GML input: `*.gml`

The project does not support arbitrary custom GML file extensions (e.g. `.gmlx`, `.foo`), and there is no user-facing configuration for that. Matching the real GameMaker environment keeps the parser focused and avoids extra modes, surface area, and confusion.

### Testing and tooling

- Tests run against the compiled output in each workspace:
  - Build with tsc → run ``node --test`` on `dist/**.test.js`.
- Type-aware linting, duplicate-code detection, and other static tools operate on the `*.ts` sources.
- Source maps (`.js.map`) make it possible to debug and interpret runtime stack traces in terms of the original TypeScript files.
- The target state for testing is that *all* tests pass in **under one minute** on a developer machine, and the test coverage is **above 90%**.

This keeps a clear separation:
- TS and tools work in `src/`.
- Node and consumers work in `dist/`.

----

## Avoid Over-Extending the System

When improving extensibility, keep changes narrow, purposeful, and internally focused. Extensions should solve real rigidity **without surfacing unnecessary configuration** or adding maintenance burden. This principle extends to all proposed configuration: if a behavior is fundamental to GameMaker’s language, syntax, semantics, or file structure, it should not be configurable. Options that exist only to “tweak internals,” enable hypothetical use cases, or support multiple contradictory modes should not be added, as they lead to unclear behavior and unnecessary maintenance complexity. As a guiding rule: if GameMaker itself doesn’t allow the user to configure something, the GML parser shouldn’t either. Configuration should only be introduced when it solves a real, recurring need and applies to non-language concerns such as paths, tooling integration, or output formatting—never the core language behavior itself.

The following are anti-patterns—examples of what **not to do** when adding project extensibility.

* Do **NOT** add an end-user option for custom file extensions in the GML parser.
Supporting arbitrary extensions like `.gmlx` or `.foo` creates needless surface area and confusion. The parser should only ever handle `.gml` files. Any configurability here just bloats code and dilutes purpose. 
* Do **NOT** include a fallback custom XML parser if the required XML library is missing.
This doubles maintenance and behavior variance. The proper fix is to ensure dependency resolution at install or build time, not duplicate functionality inside your project.
* Do **NOT** introduce a general “strategy” or “plugin” system for a single rigid branch.
Turning one fixed if/else into a generic framework leads to abstraction creep. Add only a narrow seam where flexibility is genuinely needed.
* Do **NOT** expose internal toggles as runtime configuration (env vars, CLI flags, etc.).
Developer-facing switches should stay private. End users should never see or need to set them; use internal hooks or parameters instead.
* Do **NOT** implement autodetection for formats the tool already controls. For example, if the system already mandates `.gml` and UTF-8, there is no value in guessing encoding or line endings. Keep expectations strict and predictable.

## Repository & Commit Conflict Resolution Strategy
To ensure smooth collaboration and maintain a healthy commit history, follow this structured process whenever you encounter merge, rebase, or commit conflicts within this repository:

1. **Assess the Situation**
   - Identify the branch you are on, the target branch, and the conflicting files.
   - Determine whether the conflict arises during a merge, rebase, cherry-pick, or regular commit.
   - Review the latest changes on both branches (e.g., `git log --oneline --graph --decorate`) to understand the context.

2. **Gather Context**
   - Inspect conflicting files with `git status` and `git diff --merge` or `git diff --staged` to see both sides of the changes.
   - Consult project documentation, commit messages, or related pull requests to understand the intent behind conflicting edits.
   - If the conflict stems from generated or dependency files, they should be regenerated rather than manually edited.

3. **Develop a Resolution Strategy**
   - Decide whether to favor one side, integrate both changes, or refactor to accommodate new requirements.
   - Ensure the chosen approach aligns with project conventions, coding standards, and the preservation of golden files.
   - Plan any follow-up actions, such as updating tests or documentation, before modifying files.

4. **Normalize Tooling Before the Merge**
   - Sync the latest base branch and spin up a disposable worktree so you can confirm the formatter configuration from a clean checkout:
     ```bash
     git fetch origin
     git worktree add ../base-format origin/<base>
     (cd ../base-format && pnpm run format && pnpm run lint:fix)
     ```
     The base worktree should end up clean; if the formatter produces real changes here, stop and raise a follow-up rather than committing against the base branch.
   - Back in your main worktree (the PR branch), copy the authoritative formatter/linter configuration from the base worktree:
     ```bash
     git checkout origin/<base> -- eslint.config.js ".prettier*" .editorconfig
     ```
     (Adjust the list to include any other formatter, lint, or tooling configs that affect whitespace or ordering.)
   - Install dependencies if needed and run the same normalization passes on the PR branch:
     ```bash
     pnpm run format
     pnpm run lint:fix
     git status --short
     ```
     Commit or stash only the mechanical formatter output; this step ensures both branches share the same baseline before conflicts are resolved.
   - Remove the disposable base worktree once finished:
     ```bash
     git worktree remove ../base-format
     ```

5. **Prepare a Clean Merge Environment**
   - Double-check the remote you will push to and refresh refs again (lightweight after the normalization step):
     ```bash
     git remote -v
     git fetch origin
     ```
   - Check out the PR branch so it tracks the remote tip (`git switch <branch>`; use `git switch --track origin/<branch>` if it is not yet local). Abort if `git status --short` shows files you did not generate in the prior normalization step.
   - Inspect the pending diff before touching conflicts:
     ```bash
     git diff --stat origin/<base>...HEAD
     ```
     This keeps the scope tight and highlights which files truly need attention.

6. **Perform the Merge Carefully**
   - Bring the base branch into the PR branch without committing immediately so you can sanity-check the changes: `git merge --no-commit --no-ff origin/<base>`
     (Rebasing is acceptable if the project requires it; use `git rebase origin/<base>` with the same discipline.)
   - Resolve conflict markers surgically. Prefer editing only the hunks that differ and keep unrelated whitespace or formatting untouched.
   - After each file is reconciled, run `git diff` to confirm only the expected sections changed.
   - Stage files incrementally (`git add <file>`) and keep the merge paused until everything looks correct. If you used `git merge --no-commit`, finish with `git commit` once satisfied. For rebases, continue with `git rebase --continue`.

7. **Validate Thoroughly**
   - Execute relevant test suites or build commands to confirm that the resolution does not introduce regressions.
   - Re-run any CLI commands or generators if the conflict involved derived artifacts, ensuring outputs remain correct.
   - Double-check that no golden fixtures were modified unintentionally.
   - Run `git diff --stat origin/<base>...HEAD` again; the stat output should list only the files you deliberately touched.

8. **Finalize the Commit History**
   - For merges, complete the merge commit with a clear message describing the conflict resolution.
   - For rebases or cherry-picks, continue the process (`git rebase --continue`, `git cherry-pick --continue`) after staging changes.
   - If conflicts required significant rework, consider amending the commit or splitting changes for clarity.
   - Ensure the branch is up to date: `git fetch origin` followed by `git merge --ff-only origin/<base>` (or `git rebase origin/<base>`) should report "Already up to date."
