# GMLoop CLI Package

Command-line interface for the GMLoop toolchain. Provides utilities for formatting GameMaker Language files, watching for changes, generating metadata, and coordinating the hot-reload development pipeline.

## Formatter/Linter/Refactor contract

- Run `refactor` to execute global transactions (Codemods), atomic cross-file edits (e.g. rename transactions), and metadata updates via a native Collection API through `@gmloop/refactor`.
- Run `parse` to inspect `.gml` parser AST output through `@gmloop/parser`.
- Run `lint` for and syntax repairs/rewrites (applies local single-file ESLint diagnostics/fixes through `@gmloop/lint`).
- Run `format` for layout-only formatting (formatter-only AST normalization + printing through `@gmloop/format`).
- Run `fix` to execute all three in one pass: project codemods, lint autofixes, and formatting.

## Commands

### `format` - Format GML Files

Wraps the Prettier plugin to format GameMaker Language files with enhanced diagnostics and error handling (targets `.gml` files only).

```bash
pnpm run cli -- format path/to/project
# Implicit format mode with path-only input
pnpm run cli -- path/to/project
# Show format command options while using path-only invocation style
pnpm run cli -- path/to/project --help
```

**Options:**

- `--path <path>` - Target file or directory path (defaults to current working directory)
- `--config <path>` - Path to `gmloop.json` used for formatter-owned options
- `--write` - Apply formatting changes (without this flag, format runs in dry-run mode)
- `--log-level <level>` - Set Prettier log level (debug, info, warn, error, silent)
- `--verbose` - Emit per-file timing and total run duration diagnostics
- `--on-parse-error <action>` - How to handle parse errors (skip, revert, abort)
- `--ignored-file-sample-limit <n>` - Limit ignored file samples in output
- `--unsupported-extension-sample-limit <n>` - Limit unsupported extension samples

**Environment Variables:**

- `PRETTIER_PLUGIN_GML_LOG_LEVEL` - Default log level
- `PRETTIER_PLUGIN_GML_ON_PARSE_ERROR` - Default parse error strategy

### `parse` - Parse GML Files to AST JSON

Runs `@gmloop/parser` over a `.gml` file or directory target. Dry-run mode writes AST JSON to stdout. With `--write`, the command writes sibling `*.ast.json` files next to each parsed `.gml` file.

```bash
pnpm run cli -- parse --path path/to/script.gml
pnpm run cli -- parse --path path/to/project > ast.json
pnpm run cli -- parse --write --path path/to/project
```

**Options:**

- `--path <path>` - Target `.gml` file or directory path (defaults to current working directory)
- `--write` - Write AST JSON files (without this flag, parse prints AST JSON to stdout)
- `--list` - Print effective command settings and exit
- `--verbose` - Emit per-file parse diagnostics to stderr

### `lint` - Lint and Auto-Fix GML Files

Runs `@gmloop/lint` over one or more paths, with optional ESLint autofix support.

```bash
pnpm run cli -- lint path/to/project
pnpm run cli -- lint --write path/to/project
```

**Options:**

- `--write` - Apply automatic fixes
- `--warn-ignored` - Include ignored-file warnings from ESLint (disabled by default to reduce noisy output)
- `--formatter <name>` - Formatter output (`stylish|json|checkstyle`)
- `--max-warnings <count>` - Fail when warning count exceeds limit
- `--config <path>` - Path to a custom/override `gmloop.json`
- `--no-default-config` - Disable bundled fallback config
- `--path <path>` - Force project root directory or `.yyp` path
- `--project-strict` - Fail when linted files are outside forced project root
- `--quiet` - Suppress fallback/config discovery warnings
- `--verbose` - Emit per-file lint/format timing and total run duration diagnostics

`lint` processes targets file-by-file in sequence. With `--write`, each processed file path is emitted immediately to `stderr` as progress output while fixes are written incrementally.

Post-lint config inspections (overlay wiring and processor policy enforcement) also run sequentially per file to bound peak memory usage on very large project scans.

If you use a custom ESLint flat config and enable Feather or performance
overlay rules, make sure the matching config entry also wires the canonical GML
plugin and language (`plugins: { gml: Lint.plugin }` and
`language: "gml/gml"`). Otherwise the CLI now emits an actionable
`GML_OVERLAY_WITHOUT_LANGUAGE_WIRING` warning that points back to the affected
files.

`lint` does not build project-wide semantic indexes or coordinate cross-file fixes. `--path` only scopes out-of-root warnings and `--project-strict` enforcement for the current invocation. Project-wide identifier indexing, rename safety, codemods, and hoist-name generation belong in `@gmloop/refactor`.

If a target does not contain any `.gml` files, `lint` now prints an explicit
guidance message explaining that only `.gml` sources are processed and includes
an example invocation.

### `fix` - Project-Wide Fix Workflow

Runs the project-wide write workflow in one command:

1. `refactor codemod --write`
2. `lint --write`
3. `format`

```bash
pnpm run cli -- fix --path path/to/project
pnpm run cli -- fix --only namingConvention
```

**Options:**

- `--path <path>` - Explicit GameMaker project root directory or `.yyp` path
- `--config <path>` - Path to a custom/override `gmloop.json`
- `--write` - Apply writes for the full workflow (without this flag, workflow runs dry-run)
- `--only <ids>` - Comma-separated list of configured refactor codemod ids to run
- `--verbose` - Enable verbose diagnostics for all three stages

`fix` is intentionally project-scoped and write-only. It runs the configured codemod set first so cross-file/project-aware edits happen before single-file lint fixes and final formatting normalization.

### `watch` - Monitor Files for Hot-Reload Pipeline

**NEW**: Now integrated with the transpiler to generate JavaScript patches when GML files change.

Watches GML source files and coordinates the hot-reload development pipeline. When files change, the command:

1. Detects file system changes (native or polling)
2. Reads modified GML source code
3. **Transpiles GML to JavaScript** using the transpiler module
4. Generates hot-reload patches with script IDs
5. Streams patches to runtime wrapper via WebSocket

```bash
# Basic usage - watch current directory
pnpm run cli -- watch

# Watch specific directory with verbose output
pnpm run cli -- watch /path/to/project --verbose

# Auto-inject hot-reload runtime and start watching
pnpm run cli -- watch /path/to/project --auto-inject
```

**Options:**

- `[targetPath]` - Directory to watch (default: current directory)
- `--extensions <ext...>` - File extensions to watch (default: `.gml`)
- `--polling` - Use polling instead of native file watching
- `--polling-interval <ms>` - Polling interval in milliseconds (default: 1000)
- `--verbose` - Enable verbose logging with detailed transpilation output
- `--quiet` - Suppress non-essential output (only show errors and server URLs); useful for CI/CD or background processes
- `--debounce-delay <ms>` - Delay in milliseconds before transpiling after file changes (default: 100, set to 0 to disable debouncing)
- `--max-concurrent-dirs <count>` - Maximum number of directories to scan concurrently during initial file discovery (default: 4); increase for faster scans on systems with more resources, or decrease to avoid file handle exhaustion on resource-constrained systems
- `--max-patch-history <count>` - Maximum number of patches to retain in memory (default: 100)
- `--websocket-port <port>` - WebSocket server port for streaming patches (default: 17890)
- `--websocket-host <host>` - WebSocket server host for streaming patches (default: 127.0.0.1)
- `--no-websocket-server` - Disable WebSocket server for patch streaming
- `--status-port <port>` - HTTP status server port for querying watch command status (default: 17891)
- `--status-host <host>` - HTTP status server host for querying watch command status (default: 127.0.0.1)
- `--no-status-server` - Disable HTTP status server
- `--runtime-root <path>` - Path to the HTML5 runtime assets
- `--runtime-package <name>` - Package name for the HTML5 runtime (default: gamemaker-html5)
- `--no-runtime-server` - Disable starting the HTML5 runtime static server
- `--auto-inject` - **NEW**: Automatically inject the hot-reload runtime wrapper into the HTML5 output directory before starting the watcher (default: false)
- `--html5-output <path>` - Path to the HTML5 output directory for auto-injection (overrides auto-detection; used with `--auto-inject`)
- `--gm-temp-root <path>` - Root directory for GameMaker HTML5 temporary outputs (default: `/private/tmp/GameMakerStudio2/GMS2TEMP`; used with `--auto-inject`)

**Note:** The `--verbose` and `--quiet` flags cannot be used together.

**Example Output:**

```
Watching: /path/to/project
Extensions: .gml
Mode: native

WebSocket patch server ready at ws://127.0.0.1:17890

Waiting for file changes... (Press Ctrl+C to stop)

[2025-11-05T18:28:54.771Z] change: example.gml
  ↳ Read 7 lines
  ↳ Transpiled to JavaScript (234 chars in 2.45ms)
  ↳ Generated patch: gml/script/example
  ↳ Streamed to 1 client(s)

^C
--- Transpilation Statistics ---
Total patches generated: 15
Total transpilation time: 42.13ms
Average transpilation time: 2.81ms
Total source processed: 12.45 KB
Total output generated: 8.23 KB
Output/source ratio: 66.1%
Fastest transpilation: 1.23ms (simple_script.gml)
Slowest transpilation: 5.67ms (complex_script.gml)
-------------------------------
```

**Automatic Hot-Reload Setup:**

The `--auto-inject` flag streamlines the development workflow by automatically preparing the hot-reload environment before starting the watcher. This eliminates the need to manually run `prepare-hot-reload` as a separate step:

```bash
# Traditional two-step workflow (still supported):
pnpm run cli -- prepare-hot-reload --html5-output /path/to/output
pnpm run cli -- watch /path/to/project

# Streamlined one-step workflow with --auto-inject:
pnpm run cli -- watch /path/to/project --auto-inject

# Specify custom HTML5 output directory:
pnpm run cli -- watch /path/to/project --auto-inject --html5-output /path/to/output

# Use custom WebSocket port for both injection and server:
pnpm run cli -- watch /path/to/project --auto-inject --websocket-port 18000
```

When `--auto-inject` is enabled, the watch command will:

1. Locate the most recent GameMaker HTML5 output (or use the path specified with `--html5-output`)
2. Copy the runtime wrapper assets into the output directory
3. Inject the WebSocket client bootstrap snippet into `index.html`
4. Start the file watcher and WebSocket server

The WebSocket URL injected into the HTML5 output will match the `--websocket-host` and `--websocket-port` options, ensuring seamless connectivity between the game and the watcher.

**Debouncing File Changes:**

The watch command includes intelligent debouncing to prevent unnecessary transpilations when files change rapidly (e.g., during IDE auto-save or when making multiple quick edits). By default, the watcher waits 100ms after the last file change before transpiling, which:

- **Reduces system load** - Only transpiles once per burst of edits instead of on every keystroke
- **Minimizes WebSocket traffic** - Sends one patch instead of many rapid updates
- **Improves user experience** - Provides smoother hot-reload without flicker
- **Prevents race conditions** - Avoids overlapping transpilations of the same file

Configure the debounce delay with `--debounce-delay`:

```bash
# Use default 100ms debounce
pnpm run cli -- watch

# Increase debounce for slower systems
pnpm run cli -- watch --debounce-delay 500

# Disable debouncing (transpile immediately on every change)
pnpm run cli -- watch --debounce-delay 0
```

When the watch command stops (via Ctrl+C or abort signal), any pending debounced transpilations are flushed immediately to ensure no work is lost.

**Startup Performance:**

The watch command is optimized for fast startup, especially when working with large GameMaker projects containing many GML files. Key optimizations include:

- **Parallel file scanning** - Script names and symbols are collected using concurrent file I/O, significantly reducing startup time for projects with hundreds of files
- **Efficient directory traversal** - Files in each directory are processed in parallel while directory traversal happens sequentially to avoid overwhelming the file system
- **Lazy transpilation** - Initial scan only collects script names; full transpilation happens in the background after the watcher is ready
- **Targeted dependent invalidation** - When exported symbols change, only files that reference the changed symbol names are retranspiled, avoiding unnecessary downstream work during hot reload
- **Bounded dependent retranspilation fan-out** - Dependent retranspiles run concurrently but respect the watch concurrency cap, reducing latency spikes and filesystem contention when a change impacts many scripts

For projects with 50+ GML files, these optimizations reduce watch command startup time by 3-5x compared to sequential processing. The startup time scales linearly with the number of files rather than exponentially, making the watcher practical for even the largest GameMaker projects.

**Quiet Mode:**

For CI/CD pipelines, automated testing, or when running the watcher in the background, use `--quiet` to suppress non-essential output:

```bash
# Quiet mode - only shows server URLs and errors
pnpm run cli -- watch --quiet

# Example output in quiet mode:
# Runtime static server ready at http://127.0.0.1:51234
# WebSocket patch server ready at ws://127.0.0.1:17890
#
# (transpilation happens silently, only errors are shown)
# Error: Transpilation failed: Unexpected token at line 5
```

Quiet mode is particularly useful for:

- CI/CD pipelines where verbose output clutters logs
- Background processes where you only care about errors
- Automated testing environments
- Production-like monitoring setups

**Status Server:**

The watch command includes an HTTP status server that provides real-time metrics and monitoring without interrupting the watch process. The status server exposes multiple JSON endpoints for different monitoring use cases, from lightweight connectivity checks to comprehensive health status.

```bash
# Start watch command (status server runs on port 17891 by default)
pnpm run cli -- watch /path/to/project
```

**Available Endpoints:**

**`GET /status`** - Comprehensive runtime status with detailed metrics

```bash
curl http://127.0.0.1:17891/status

# Example response:
{
  "uptime": 125430,
  "patchCount": 42,
  "errorCount": 2,
  "recentPatches": [
    {
      "id": "gml/script/player_move",
      "timestamp": 1703890145123,
      "durationMs": 2.34,
      "filePath": "player_move.gml"
    },
    ...
  ],
  "recentErrors": [
    {
      "timestamp": 1703890100456,
      "filePath": "broken_script.gml",
      "error": "Unexpected token at line 5"
    }
  ],
  "websocketClients": 1
}
```

**`GET /health`** - Health check with component status (for monitoring systems)

```bash
curl http://127.0.0.1:17891/health

# Example response:
{
  "status": "healthy",
  "timestamp": 1703890200000,
  "uptime": 125430,
  "checks": {
    "transpilation": {
      "status": "pass",
      "patchCount": 42,
      "errorCount": 2
    },
    "websocket": {
      "status": "pass",
      "clients": 1
    }
  }
}
```

**`GET /ping`** - Lightweight connectivity check (minimal overhead)

```bash
curl http://127.0.0.1:17891/ping

# Example response:
{
  "status": "ok",
  "timestamp": 1703890200000
}
```

**`GET /ready`** - Readiness probe (for Kubernetes/container orchestration)

```bash
curl http://127.0.0.1:17891/ready

# Example response when ready:
{
  "ready": true,
  "timestamp": 1703890200000,
  "uptime": 125430
}

# Returns HTTP 503 when not ready (excessive errors)
```

**Endpoint Comparison:**

| Endpoint  | Purpose       | Response Size | Use Case                                   |
| --------- | ------------- | ------------- | ------------------------------------------ |
| `/status` | Full metrics  | Large         | Monitoring dashboards, debugging           |
| `/health` | Health checks | Medium        | Monitoring systems (Prometheus, Datadog)   |
| `/ping`   | Connectivity  | Minimal       | Load balancers, simple health checks       |
| `/ready`  | Readiness     | Small         | Kubernetes readiness probes, orchestration |

**Status Endpoint Fields:**

- `uptime`: Milliseconds since the watch command started
- `patchCount`: Total number of patches generated successfully
- `errorCount`: Total number of transpilation errors encountered
- `recentPatches`: Array of the last 10 successful patches with metadata
- `recentErrors`: Array of the last 10 errors with details
- `websocketClients`: Number of currently connected WebSocket clients

**Use Cases:**

- **Health Monitoring**: Integration with monitoring tools (Prometheus, Datadog, etc.) via `/health`
- **Load Balancing**: Use `/ping` for lightweight health checks in load balancer configurations
- **Container Orchestration**: Kubernetes readiness/liveness probes using `/ready` and `/health`
- **CI/CD Pipelines**: Automated tests can verify the watch command is processing files via `/status`
- **Debugging**: Quickly inspect recent patches and errors without restarting the watcher
- **Dashboard Integration**: Build custom monitoring dashboards for development teams

**Configuration:**

```bash
# Use custom port
pnpm run cli -- watch --status-port 8080

# Disable status server
pnpm run cli -- watch --no-status-server
```

**Hot-Reload Integration:**

The watch command now integrates with the transpiler module (`src/transpiler`) to generate JavaScript patches on file changes. Each patch contains:

- `kind`: "script" (or "event" in future iterations)
- `id`: Symbol identifier (e.g., `gml/script/my_script`)
- `js_body`: Transpiled JavaScript code
- `sourceText`: Original GML source for debugging
- `version`: Timestamp of transpilation

**Planned: Semantic Analysis Integration**

The watch command now includes a **dependency tracker** that maintains file-to-symbol mappings as a foundation for future semantic integration. When files change, the tracker records which symbols they define, preparing the system for dependency-aware hot-reload.

**Current Status:**

- ✅ Lightweight dependency tracker integrated into watch command
- ✅ Symbol definitions tracked per file
- ✅ Foundation for dependency graph construction

**Planned Enhancements:**

Future iterations will integrate with the semantic analyzer (`src/semantic`) to enable full dependency-aware hot-reload:

1. Parse changed files to extract AST
2. Analyze files semantically to identify symbol definitions and references
3. Track project-wide dependency graph (which scripts call which)
4. When a file changes, automatically re-transpile dependent scripts
5. Coordinate invalidation cascades through the dependency graph

This integration requires expanding the semantic package's public API to export `ScopeTracker` or providing an alternative coordinator interface. The current design intentionally keeps `ScopeTracker` internal to enforce use of higher-level semantic coordinators.

**Error Recovery and Resilience:**

The watch command includes robust error handling to maintain stability:

- **Graceful Degradation**: Transpilation errors don't stop the watcher. When a file fails to transpile, the error is logged and the watcher continues monitoring other files.
- **Error Notifications**: Failed transpilations send error notifications to connected WebSocket clients with the format `{ kind: "error", filePath, error, timestamp }`.
- **Patch Validation**: All patches are validated before broadcast to ensure they contain valid data (non-empty JavaScript body, proper structure).
- **Last Successful Patch Tracking**: The system stores the last successful patch for each script, enabling potential rollback scenarios.
- **Error Metrics**: Errors are tracked alongside successful transpilations, with statistics displayed when the watcher stops.
- **Statistics Summary**: On exit, the watch command displays both success metrics (patches generated, transpilation time) and error metrics (total errors, recent error details in verbose mode).

**Current Status:**

✅ File watching (native and polling modes)
✅ Change detection and file reading
✅ GML → JavaScript transpilation
✅ Patch generation with script IDs
✅ Runtime context initialization
✅ WebSocket server for patch streaming
✅ Real-time patch broadcast to connected clients
✅ **Transpilation metrics tracking** ✨
✅ **Performance statistics on watch stop** ✨

### `prepare-hot-reload` - Inject Runtime Wrapper

Injects the hot-reload runtime wrapper into the most recent GameMaker HTML5 output
so the running game connects to the patch server automatically.

```bash
# Inject into the latest HTML5 output
pnpm run cli -- prepare-hot-reload

# Inject into a specific HTML5 output directory
pnpm run cli -- prepare-hot-reload --html5-output /path/to/html5/output
```

**Options:**

- `--html5-output <path>` - Path to the HTML5 output directory
- `--gm-temp-root <path>` - Root directory for GameMaker HTML5 temp outputs
- `--websocket-url <url>` - WebSocket URL for hot-reload patches
- `--force` - Re-inject even if snippet already exists
- `--quiet` - Suppress informational output

When GameMaker is running the HTML5 server, the command auto-detects the active
`-root` folder from the GMWebServ process and targets that output first.
✅ **Configurable patch history limit** ✨
✅ **Error recovery and graceful degradation** ✨
✅ **Patch validation before broadcast** ✨
✅ **Error notifications to clients** ✨
✅ **Last successful patch tracking** ✨
✅ **Error statistics and reporting** ✨
✅ **Debounced file change handling** ✨
✅ **Quiet mode for CI/CD environments** ✨
✅ **HTTP status server for runtime monitoring** ✨ NEW

🚧 Future Enhancements:

- Semantic analysis integration for scope-aware transpilation
- Dependency tracking to rebuild dependent scripts
- Event transpilation (not just scripts)
- Shader and asset hot-reloading

### `watch-status` - Query Watch Command Status

Queries the running watch command's status server for real-time metrics and diagnostics without interrupting the watcher. This provides a convenient human-friendly interface to the watch command's HTTP status server.

```bash
# Query full status with metrics and recent patches
pnpm run cli -- watch-status

# Get health check information
pnpm run cli -- watch-status --endpoint health

# Check if watch command is running (lightweight ping)
pnpm run cli -- watch-status --endpoint ping

# Query readiness status (for Kubernetes/orchestration)
pnpm run cli -- watch-status --endpoint ready

# Get JSON output for scripting/automation
pnpm run cli -- watch-status --format json

# Query custom host/port
pnpm run cli -- watch-status --status-host 127.0.0.1 --status-port 18000
```

**Options:**

- `--status-host <host>` - Status server host (default: 127.0.0.1, env: WATCH_STATUS_HOST)
- `--status-port <port>` - Status server port (default: 17891, env: WATCH_STATUS_PORT)
- `--format <format>` - Output format: `pretty` (default) or `json`
- `--endpoint <endpoint>` - Endpoint to query: `status` (default), `health`, `ping`, or `ready`

**Example Output:**

```
$ pnpm run cli -- watch-status
=== Watch Command Status ===

Uptime: 2h 15m 43s
Total patches: 42
Total errors: 2
WebSocket clients: 1

Recent patches:
  15s ago - scripts/player_move.gml
    ID: gml_Script_player_move
    Duration: 2.34ms
  2m ago - scripts/enemy_ai.gml
    ID: gml_Script_enemy_ai
    Duration: 3.12ms

Recent errors:
  1h ago - scripts/broken_script.gml
    Error: Unexpected token at line 5
```

**Use Cases:**

- **Development Monitoring**: Quickly check if the watch command is still processing files correctly
- **Debugging**: Inspect recent transpilation errors and their timing
- **Performance Analysis**: Review transpilation duration for optimization
- **CI/CD Integration**: Use `--format json` to programmatically check watch command health
- **Container Health Checks**: Query `/health` or `/ready` endpoints for orchestration systems

This command is particularly useful when:

- The watch command is running in a background terminal or tmux session
- You want to verify hot-reload is working without checking logs
- You need to debug why a script isn't updating in the game
- You're monitoring performance during development

### `refactor` - Safe Code Transformations

Performs safe, project-wide code transformations such as renaming symbols while preserving scope and semantics.

```bash
# Rename a script by symbol ID
pnpm run cli -- refactor --symbol-id gml/script/scr_old_name --new-name scr_new_name

# Rename by current name
pnpm run cli -- refactor --old-name player_hp --new-name playerHealth

# Dry run to preview changes
pnpm run cli -- refactor --old-name player_hp --new-name playerHealth

# Validate hot reload compatibility
pnpm run cli -- refactor --old-name player_hp --new-name playerHealth --check-hot-reload

# Verbose output with diagnostics
pnpm run cli -- refactor --old-name player_hp --new-name playerHealth --verbose

# List configured gmloop.json codemods and effective config
pnpm run cli -- refactor codemod --list

# Dry-run configured codemods inferred from the project config
pnpm run cli -- refactor --path path/to/project

# Dry-run configured codemods
pnpm run cli -- refactor codemod

# Apply configured codemods to selected paths only
pnpm run cli -- refactor codemod scripts/player --write

# Apply only one configured codemod
pnpm run cli -- refactor codemod --only namingConvention --write
```

**Options:**

- `--symbol-id <id>` - SCIP-style symbol identifier to rename (e.g., gml/script/scr_player)
- `--old-name <name>` - Current name of the symbol to rename
- `--new-name <name>` - New name for the symbol (required)
- `--path <path>` - Root directory of the GameMaker project (default: current directory)
- `--write` - Apply the rename/codemod changes (default behavior without `--write` is dry-run preview)
- `--verbose` - Enable verbose output with detailed diagnostics
- `--check-hot-reload` - Validate that the refactored code is compatible with hot reload

**Codemod options (`refactor codemod`):**

- `--config <path>` - Explicit path to `gmloop.json`
- `--write` - Apply configured codemods (default is dry-run)
- `--only <ids>` - Comma-separated list of configured codemod ids to run
- `--list` - Print discovered codemods and their effective normalized config

When no rename target is provided, `refactor` will automatically run configured codemods if it can resolve a `gmloop.json` for the project.

**`gmloop.json` refactor config:**

```json
{
    "printWidth": 95,
    "lintRules": {
        "gml/no-globalvar": "error"
    },
    "refactor": {
        "codemods": {
            "namingConvention": {
                "rules": {
                    "localVariable": {
                        "caseStyle": "camel"
                    }
                }
            },
            "loopLengthHoisting": {
                "functionSuffixes": {
                    "array_length": "len"
                }
            }
        }
    }
}
```

**Ownership note:** `refactor` is a separate domain from lint.

- Use `lint --write` for lint-owned diagnostics/content rewrites.
- Use `refactor` for explicit symbol rename/refactor transactions with cross-file edit planning.
- Refactor operations are not lint rule fixes and are not executed through formatter runtime adapters.

**Use Cases:**

- **Safe Renaming**: Rename variables, scripts, or other symbols project-wide without breaking scope
- **Refactoring Preparation**: Preview changes by default, then apply with `--write` when ready
- **Hot Reload Validation**: Ensure refactored code remains compatible with live updates using `--check-hot-reload`
- **Development Workflow Integration**: Coordinate with watch mode for real-time refactoring feedback

**Current scope:**

- Safe rename planning/execution
- Configured codemod execution via `gmloop.json`
- Dry-run preview support
- Hot-reload validation integration
- Verbose diagnostics for conflict/impact review

### `generate-gml-identifiers` - Generate Identifier Metadata

Generates GML identifier metadata from the GameMaker manual repository.

```bash
pnpm run cli -- generate-gml-identifiers
```

### `lookup-gml-identifier` - Query Built-In Metadata

Looks up a built-in GML keyword/function/identifier from `gml-identifiers.json`
(the manual-derived snapshot). This command does not maintain a separate glossary;
it reads the identifier snapshot directly.

```bash
pnpm run cli -- lookup-gml-identifier draw_text
pnpm run cli -- lookup-gml-identifier draw_text --json
```

Behavior:

- Exit code `0`: identifier exists in the snapshot.
- Exit code `2`: identifier is not recognized as a built-in.

### `generate-feather-metadata` - Generate Feather Metadata

Generates Feather metadata for GameMaker's static analysis.

```bash
pnpm run cli -- generate-feather-metadata
```

## Architecture

The CLI package serves as the orchestration layer for the hot-reload development pipeline:

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI (src/cli)                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                   watch command                       │  │
│  │  • File system monitoring                             │  │
│  │  • Change detection                                   │  │
│  │  • Runtime context management                         │  │
│  │  • Server lifecycle coordination                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │       Transpilation Coordinator ✅ NEW                │  │
│  │  • Transpilation lifecycle management                 │  │
│  │  • Metrics tracking and statistics                    │  │
│  │  • Patch validation                                   │  │
│  │  • Error handling and recovery                        │  │
│  │  • WebSocket broadcast coordination                   │  │
│  └───────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              WebSocket Server ✅                      │  │
│  │  • Real-time patch broadcasting                       │  │
│  │  • Client connection management                       │  │
│  │  • Automatic reconnection support                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓
          ┌────────────────────────────────┐
          │   Transpiler (src/transpiler)  │
          │   • GML parsing                │
          │   • AST → JavaScript emission  │
          │   • Operator mapping           │
          └────────────────────────────────┘
                           ↓
          ┌────────────────────────────────┐
          │  Runtime Wrapper               │
          │  • WebSocket client ✅         │
          │  • Patch application ✅        │
          │  • Hot function swapping ✅    │
          │  • State preservation          │
          └────────────────────────────────┘
```

### Module Organization

The CLI package is organized into focused, single-responsibility modules:

**Commands** (`src/commands/`)

- `watch.ts` - File system monitoring and hot-reload orchestration
- `refactor.ts` - Safe, project-wide code transformations
- `format.ts` - GML code formatting
- `generate-gml-identifiers.ts` - Identifier metadata generation
- `lookup-gml-identifier.ts` - Built-in identifier lookup from manual-derived metadata
- `generate-feather-metadata.ts` - Feather metadata generation

**Modules** (`src/modules/`)

- `transpilation/` - Transpilation coordination and metrics tracking
- `websocket/` - WebSocket server for patch streaming
- `status/` - HTTP status server for runtime monitoring
- `runtime/` - HTML5 runtime integration
- `manual/` - GameMaker manual processing
- `feather/` - Feather metadata handling

## Development

### Running Tests

```bash
# All CLI tests
pnpm run test:cli

# Specific test file
node --test src/cli/test/watch-command.test.js

# Watch mode
pnpm run test:cli -- --watch
```

### Testing Watch Command

```bash
# Create a test directory
mkdir -p /tmp/gml-test
echo "var x = 10; show_debug_message(x);" > /tmp/gml-test/test.gml

# In another terminal, modify the file to see transpilation
echo "var y = 20;" >> /tmp/gml-test/test.gml
```

### Debugging Transpilation

To see the transpiled JavaScript output for a GML file:

```javascript
import { createTranspiler } from "./src/transpiler/src/index.js";
import { readFile } from "node:fs/promises";

const transpiler = createTranspiler();
const content = await readFile("path/to/script.gml", "utf8");

const patch = await transpiler.transpileScript({
    sourceText: content,
    symbolId: "gml/script/my_script"
});

console.log(patch.js_body);
```

### Transpilation Coordinator

The transpilation coordinator module (`src/modules/transpilation/coordinator.ts`) manages the complete transpilation lifecycle within the watch command:

**Key Responsibilities:**

- **Transpilation Lifecycle**: Coordinates the end-to-end process from GML source to validated JavaScript patches
- **Metrics Tracking**: Records transpilation duration, file sizes, line counts, and performance statistics
- **Error Management**: Handles transpilation failures gracefully with detailed error tracking
- **Patch Validation**: Ensures generated patches meet quality requirements before broadcasting
- **WebSocket Integration**: Coordinates patch broadcasting to connected runtime clients
- **Statistics Reporting**: Provides comprehensive statistics on watch command exit

**API:**

```typescript
import {
    transpileFile,
    displayTranspilationStatistics
} from "/cli/modules/transpilation";

// Transpile a single file with lifecycle management
const result = transpileFile(
    context, // TranspilationContext with transpiler and metrics storage
    filePath, // Path to the GML file
    content, // GML source code
    lines, // Number of lines in the source
    { verbose, quiet } // Output options
);

// Display statistics when watch stops
displayTranspilationStatistics(
    context, // Context with metrics and errors
    verbose, // Enable detailed statistics
    quiet // Suppress all output
);
```

The coordinator is designed to be a focused, single-responsibility module that handles all transpilation orchestration concerns, keeping the watch command focused on file system monitoring and server lifecycle management.

## Integration with Other Modules

### Parser (`src/parser`)

Provides ANTLR-based GML parsing used by the transpiler.

### Transpiler (`src/transpiler`)

✅ **Integrated** - Converts GML AST to JavaScript for hot-reload patches.

### Semantic (`src/semantic`)

✅ **Integrated** - Supplies analysis data consumed by refactor planning and hot-reload dependency tracking.

### Runtime Wrapper (`src/runtime-wrapper`)

✅ **Ready** - Has WebSocket client and patch application, ready to receive patches.

### Refactor (`src/refactor`)

✅ **Integrated** - Powers explicit cross-file rename/refactor transactions (`cli refactor`).

## References

- [Hot Reload Architecture](../../docs/hot-reload.md) - Overall hot-reload architecture
- [Semantic Scope Plan](../../docs/semantic-scope-plan.md) - Semantic analysis integration
- [Transpiler README](../transpiler/README.md) - GML → JavaScript transpilation details
- [Runtime Wrapper README](../runtime-wrapper/README.md) - Patch application and hot-swapping

## Change Log

### Recent Updates

- **2026-01-06**: Integrated dependency tracker for watch command
    - Added DependencyTracker module for file-to-symbol mapping
    - Tracks symbol definitions to enable future dependency-aware invalidation
    - Foundation for semantic analysis integration
    - Provides statistics on tracked symbols in verbose mode
    - Designed for efficient dependency graph queries
- **2025-11-06**: Completed hot-reload integration loop
    - Added WebSocket server to watch command for real-time patch streaming
    - Integrated patch broadcasting to all connected runtime wrapper clients
    - Added connection management and client tracking
    - Created end-to-end integration test for patch delivery
    - Updated documentation with WebSocket configuration options
    - Watch command now provides complete hot-reload pipeline from file change to patch delivery
- **2025-11-05**: Integrated transpiler into watch command for hot-reload pipeline
    - Watch command now transpiles GML files to JavaScript on change
    - Generates patch objects with script IDs
    - Added verbose logging for transpilation details
    - Added test coverage for transpilation integration
    - Stores patches in runtime context for future streaming
