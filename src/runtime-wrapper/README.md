# Runtime Wrapper Module

This package hosts the browser-side runtime wrapper described in
`docs/hot-reload.md`. It receives transpiler patches from the CLI over a WebSocket
connection and swaps them into the running GameMaker HTML5 export without restarting the game.

## Responsibilities

- Maintain the hot registry for scripts, events, and closures.
- Provide patch application helpers that the development shell can call.
- Surface lifecycle hooks for migrations when hot-reloading Create events.
- Offer lightweight diagnostics so the CLI and developer can inspect patch state.
- Provide structured diagnostic logging for development debugging.

## Directory layout

- `src/` – wrapper source files that ship to the browser or dev iframe.
- `test/` – unit tests that exercise the wrapper in a simulated environment.

## API

### `createRuntimeWrapper(options)`

Creates a new runtime wrapper instance with hot-reload capabilities.

**Options:**

- `registry` (optional): Initial registry state with `scripts`, `events`, and `closures`.
- `onPatchApplied` (optional): Callback invoked after each successful patch application.
- `validateBeforeApply` (optional): When `true`, validates patches in a shadow registry before applying to the real registry. Default is `false`.
- `onChange` (optional): Lifecycle listener that receives events for all registry changes (patch applied, undone, rolled back, registry cleared). See [Registry Lifecycle Hooks](#registry-lifecycle-hooks) for details.
- `maxUndoStackSize` (optional): Maximum number of undo snapshots to retain. When the limit is reached, the oldest snapshots are automatically discarded. Default is `50`. Set to `0` for unlimited (not recommended for long-running sessions).
- `maxErrorHistorySize` (optional): Maximum number of error records to retain in the error history. When the limit is reached, the oldest error records are automatically discarded. Default is `100`. Set to `0` for unlimited (not recommended for long-running sessions). This prevents unbounded memory growth during development sessions with frequent errors.

**Returns:** An object with the following methods:

#### `applyPatch(patch)`

Applies a patch to the runtime registry. The patch object must have:

- `kind`: Either `"script"`, `"event"`, or `"closure"`
- `id`: Unique identifier for the patch
- `js_body`: JavaScript function body as a string
- `metadata` (optional): Additional context about the patch:
    - `sourcePath` (optional): File path where this patch originated
    - `sourceHash` (optional): Hash of the source code for cache validation
    - `timestamp` (optional): When the patch was created
    - `dependencies` (optional): Array of patch IDs this patch depends on

When `validateBeforeApply` is enabled, patches are validated in a shadow registry first. Invalid patches are rejected before touching the real registry.

**Dependency Validation:**

The runtime wrapper automatically validates that all dependencies specified in `patch.metadata.dependencies` are satisfied before applying the patch. A dependency is considered satisfied if a patch with the specified ID exists in any of the registry collections (scripts, events, or closures).

If any dependencies are missing, the patch application fails with a validation error that lists all unsatisfied dependencies. This prevents runtime errors caused by calling functions or referencing patches that haven't been applied yet.

**Example with dependencies:**

```javascript
const wrapper = createRuntimeWrapper();

// Apply base function first
wrapper.applyPatch({
    kind: "script",
    id: "script:calculate_base",
    js_body: "return args[0] * 10;"
});

// Apply dependent function - succeeds because dependency exists
wrapper.applyPatch({
    kind: "script",
    id: "script:calculate_bonus",
    js_body: "return calculate_base(args[0]) + 5;",
    metadata: {
        dependencies: ["script:calculate_base"]
    }
});

// This would fail - missing dependency
try {
    wrapper.applyPatch({
        kind: "script",
        id: "script:broken",
        js_body: "return missing_fn();",
        metadata: {
            dependencies: ["script:missing_fn"]
        }
    });
} catch (error) {
    console.error(error.message);
    // "Patch script:broken has unsatisfied dependencies: script:missing_fn"
}
```

Returns `{ success: true, version: <number> }` on success.

#### `applyPatchBatch(patches)`

Applies multiple patches atomically as a single operation. Either all patches succeed, or the entire batch is rolled back.

**Parameters:**

- `patches`: Array of patch objects (same format as `applyPatch`)

**Behavior:**

1. Validates all patches upfront (structure, dependency, and shadow validation if enabled)
2. If validation fails (including unsatisfied dependencies), returns error without applying any patches
3. Applies patches sequentially, recording each in the undo stack
4. If any patch fails during application, automatically rolls back all previously applied patches in the batch
5. Records a batch operation marker in the patch history

**Dependency Validation in Batches:**

Dependencies are validated in the same order patches are applied. A dependency can be satisfied by the current registry or by a patch that appears earlier in the same batch. Forward references (dependencies declared later in the same batch) still fail validation.

For interdependent batches:

- Order patches from foundational dependencies to dependent patches
- Keep dependency metadata explicit and minimal
- Use separate `applyPatch()` calls only when batch order cannot be guaranteed

**Returns:**

- On success: `{ success: true, version: <number>, appliedCount: <number>, rolledBack: false }`
- On validation failure: `{ success: false, appliedCount: 0, failedIndex: <number>, error: <string>, message: <string>, rolledBack: false }`
- On application failure with rollback: `{ success: false, appliedCount: <number>, failedIndex: <number>, error: <string>, message: <string>, rolledBack: true }`

**Benefits:**

- **Atomicity**: All-or-nothing application ensures registry consistency
- **Performance**: Reduces overhead compared to applying patches individually
- **Safety**: Automatic rollback on failure maintains registry integrity
- **Debugging**: Batch markers in history make it easy to track multi-patch operations

**Example:**

```javascript
const wrapper = createRuntimeWrapper();

const patches = [
    {
        kind: "script",
        id: "script:player_move",
        js_body: "return args[0] * 2;"
    },
    { kind: "event", id: "obj_player#Step", js_body: "this.x += 1;" },
    {
        kind: "closure",
        id: "closure:counter",
        js_body: "let n = 0; return () => ++n;"
    }
];

const result = wrapper.applyPatchBatch(patches);
if (result.success) {
    console.log(
        `Applied ${result.appliedCount} patches at version ${result.version}`
    );
} else {
    console.error(
        `Batch failed at patch ${result.failedIndex}: ${result.message}`
    );
    if (result.rolledBack) {
        console.log("All changes were rolled back");
    }
}
```

#### `trySafeApply(patch, onValidate)`

Applies a patch with automatic rollback on failure. This method:

1. Validates the patch in a shadow registry to catch syntax errors
2. Optionally runs a custom validation callback
3. Applies the patch to the real registry
4. Automatically rolls back if any step fails

**Parameters:**

- `patch`: Patch object (same format as `applyPatch`)
- `onValidate` (optional): Custom validation function that receives the patch and returns `true`/`false` or throws an error

**Returns:**

- On success: `{ success: true, version: <number>, rolledBack: false }`
- On shadow validation failure: `{ success: false, error: <string>, message: <string> }`
- On rollback: `{ success: false, error: <string>, message: <string>, rolledBack: true }`

Rollback operations are recorded in the patch history with `action: "rollback"`.

#### `undo()`

Reverts the most recently applied patch.

Returns `{ success: true, version: <number> }` on success, or `{ success: false, message: <string> }` if there's nothing to undo.

#### `getUndoStackSize()`

Returns the current number of undo snapshots available. This is useful for monitoring memory usage in long-running development sessions and understanding how many operations can be undone.

The undo stack size is automatically limited by the `maxUndoStackSize` option (default: 50). When the limit is reached, older snapshots are discarded to prevent unbounded memory growth.

**Example:**

```javascript
const wrapper = createRuntimeWrapper({ maxUndoStackSize: 100 });

wrapper.applyPatch({
    kind: "script",
    id: "script:test",
    js_body: "return 42;"
});
console.log(wrapper.getUndoStackSize()); // 1

for (let i = 0; i < 200; i++) {
    wrapper.applyPatch({
        kind: "script",
        id: `script:test${i}`,
        js_body: `return ${i};`
    });
}
console.log(wrapper.getUndoStackSize()); // 100 (capped at maxUndoStackSize)
```

#### `getPatchHistory()`

Returns an array of all patch operations (apply, undo, and rollback) with metadata:

- `patch.kind`: Type of patch (`"script"` or `"event"`)
- `patch.id`: Patch identifier
- `version`: Registry version after the operation
- `timestamp`: Time when the operation occurred
- `action`: Either `"apply"`, `"undo"`, or `"rollback"`
- `error` (rollback only): Error message that caused the rollback

#### `getPatchById(id)`

Returns an array of all patch history entries that match the given patch ID. This is useful for tracking the complete lifecycle of a specific patch, including initial application, any re-applications, and undo/rollback operations.

**Parameters:**

- `id`: The patch identifier to search for (e.g., `"script:player_move"` or `"obj_player#Step"`)

**Returns:** Array of `PatchHistoryEntry` objects matching the specified ID

**Example:**

```javascript
const wrapper = createRuntimeWrapper();

wrapper.applyPatch({
    kind: "script",
    id: "script:player_move",
    js_body: "return args[0] * 2;"
});

// Later, update the same patch
wrapper.applyPatch({
    kind: "script",
    id: "script:player_move",
    js_body: "return args[0] * 3;"
});

// Get all history for this specific patch
const history = wrapper.getPatchById("script:player_move");
console.log(history.length); // 2
console.log(history[0].version); // 1
console.log(history[1].version); // 2
```

#### `getPatchesByKind(kind)`

Returns an array of all patch history entries of a specific kind (script, event, or closure). This is useful for filtering patch history by type for debugging or auditing purposes.

**Parameters:**

- `kind`: The patch type to filter by (`"script"`, `"event"`, or `"closure"`)

**Returns:** Array of `PatchHistoryEntry` objects with the specified kind

**Example:**

```javascript
const wrapper = createRuntimeWrapper();

wrapper.applyPatch({
    kind: "script",
    id: "script:a",
    js_body: "return 1;"
});
wrapper.applyPatch({
    kind: "event",
    id: "obj_player#Step",
    js_body: "this.x += 1;"
});
wrapper.applyPatch({
    kind: "script",
    id: "script:b",
    js_body: "return 2;"
});

// Get only script patches
const scriptPatches = wrapper.getPatchesByKind("script");
console.log(scriptPatches.length); // 2
console.log(scriptPatches[0].patch.id); // "script:a"
console.log(scriptPatches[1].patch.id); // "script:b"

// Get only event patches
const eventPatches = wrapper.getPatchesByKind("event");
console.log(eventPatches.length); // 1
console.log(eventPatches[0].patch.id); // "obj_player#Step"
```

**Note:** When using `applyPatchBatch()`, a batch marker entry (with `kind: "script"`) is also added to the history. You can identify these by checking if the patch ID starts with `"batch:"`.

#### `getRegistrySnapshot()`

Returns a snapshot of the current registry state:

- `version`: Current registry version
- `scriptCount`: Number of registered scripts
- `eventCount`: Number of registered events
- `closureCount`: Number of registered closures
- `scripts`: Array of script IDs
- `events`: Array of event IDs
- `closures`: Array of closure IDs

#### `getPatchStats()`

Returns aggregate statistics about patch operations:

- `totalPatches`: Total number of operations
- `appliedPatches`: Number of apply operations
- `undonePatches`: Number of undo operations
- `rolledBackPatches`: Number of rollback operations
- `scriptPatches`: Number of script-related operations
- `eventPatches`: Number of event-related operations
- `closurePatches`: Number of closure-related operations
- `uniqueIds`: Number of unique patch IDs
- `averagePatchDurationMs` (optional): Average time to apply patches in milliseconds
- `totalDurationMs` (optional): Total time spent applying patches in milliseconds
- `fastestPatchMs` (optional): Fastest patch application time in milliseconds
- `slowestPatchMs` (optional): Slowest patch application time in milliseconds
- `p50DurationMs` (optional): Median (50th percentile) patch application time in milliseconds
- `p90DurationMs` (optional): 90th percentile patch application time in milliseconds
- `p99DurationMs` (optional): 99th percentile patch application time in milliseconds

**Note:** Timing metrics are only available when patches have been applied with duration tracking enabled (which is automatic in this implementation). Percentile metrics provide more insight into the distribution of patch application times, helping identify outliers and typical performance characteristics.

## Error Recovery and Safe Patch Application

The runtime wrapper provides two mechanisms for safe patch application:

### Shadow Registry Validation

When creating a wrapper with `validateBeforeApply: true`, all patches are validated in an isolated shadow registry before being applied to the real registry. This catches syntax errors and malformed patches without affecting the running application:

```javascript
const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

// Invalid patches are rejected before touching the registry
wrapper.applyPatch({
    kind: "script",
    id: "script:bad",
    js_body: "return {{ invalid syntax"
}); // Throws: Patch validation failed
```

### Automatic Rollback with `trySafeApply`

For production use, `trySafeApply` provides comprehensive error recovery:

```javascript
const wrapper = createRuntimeWrapper();

// Shadow validation + custom validation + automatic rollback
const result = wrapper.trySafeApply(
    {
        kind: "script",
        id: "script:risky",
        js_body: "return args[0] * 2;"
    },
    (patch) => {
        // Custom validation logic
        return patch.id.startsWith("script:");
    }
);

if (!result.success) {
    console.error("Patch failed:", result.message);
    if (result.rolledBack) {
        console.log("Registry was automatically restored");
    }
}
```

The `trySafeApply` method:

1. Validates patches in a shadow registry to catch syntax errors
2. Runs optional custom validation logic
3. Applies the patch if all validations pass
4. Automatically rolls back on any failure, preserving registry state
5. Records rollback operations in patch history for diagnostics

This aligns with the live reloading concept's error handling strategy of applying patches in a shadow registry first and rolling back automatically on runtime errors.

#### `getVersion()`

Returns the current registry version number.

#### `getScript(id)`

Retrieves a specific script function by ID. Returns the function or `undefined` if not found.

#### `getEvent(id)`

Retrieves a specific event function by ID. Returns the function or `undefined` if not found.

#### `hasScript(id)`

Checks if a script with the given ID exists. Returns `true` if present, `false` otherwise.

#### `hasEvent(id)`

Checks if an event with the given ID exists. Returns `true` if present, `false` otherwise.

#### `getClosure(id)`

Retrieves a specific closure function by ID. Returns the function or `undefined` if not found.

#### `hasClosure(id)`

Checks if a closure with the given ID exists. Returns `true` if present, `false` otherwise.

#### `clearRegistry()`

Clears all patches from the registry (scripts, events, and closures) and resets the undo stack. The registry version is incremented. This is useful for resetting the runtime state during development or when switching between different code versions.

**Important:** Calling `clearRegistry()` clears the undo stack, meaning you cannot undo patches applied before the clear operation. Any subsequent `undo()` call will fail until new patches are applied.

**Example:**

```javascript
const wrapper = createRuntimeWrapper();

wrapper.applyPatch({
    kind: "script",
    id: "script:test",
    js_body: "return 42;"
});
console.log(wrapper.hasScript("script:test")); // true

wrapper.clearRegistry();
console.log(wrapper.hasScript("script:test")); // false
console.log(wrapper.getVersion()); // incremented

// Undo stack is also cleared
const undoResult = wrapper.undo();
console.log(undoResult.success); // false - nothing to undo
```

#### `checkRegistryHealth()`

Validates the integrity of the runtime registry and returns a health report. This diagnostic method checks for common corruption issues such as non-function entries in the registry collections. The health check is fast and safe to call frequently during development or in automated monitoring.

**Returns:** A `RegistryHealthCheck` object with:

- `healthy` (boolean): `true` if no issues detected, `false` otherwise
- `version` (number): Current registry version at the time of the check
- `issues` (array): List of detected problems, each containing:
    - `severity`: Either `"warning"` or `"error"`
    - `category`: Issue type (`"function-type"`, `"id-format"`, or `"collection-integrity"`)
    - `message`: Human-readable description
    - `affectedId`: The registry ID that triggered the issue (if applicable)

**Example:**

```javascript
const wrapper = createRuntimeWrapper();

wrapper.applyPatch({
    kind: "script",
    id: "script:test",
    js_body: "return 42;"
});

// Validate registry integrity
const health = wrapper.checkRegistryHealth();
if (health.healthy) {
    console.log(`✓ Registry is healthy (version ${health.version})`);
} else {
    console.error(`✗ Registry has ${health.issues.length} issue(s):`);
    for (const issue of health.issues) {
        console.error(`  [${issue.severity}] ${issue.message}`);
        if (issue.affectedId) {
            console.error(`    Affected ID: ${issue.affectedId}`);
        }
    }
}
```

**Use cases:**

- Detecting accidental registry corruption during development
- Validating registry state before critical operations
- Building health monitoring dashboards
- Debugging unexpected patch application failures
- Automated testing of runtime wrapper integrity

#### `getPatchDiagnostics(id)`

Returns detailed diagnostic information for a specific patch ID, or `null` if the patch has never been applied. This method aggregates historical data to provide comprehensive insights into a patch's lifecycle, making it easier to debug hot-reload issues and understand patch behavior.

**Parameters:**

- `id`: The patch identifier to get diagnostics for (e.g., `"script:player_move"` or `"obj_player#Step"`)

**Returns:** A `PatchDiagnostics` object with:

- `id` (string): The patch identifier
- `kind` (PatchKind): The patch type (`"script"`, `"event"`, or `"closure"`)
- `applicationCount` (number): Total number of times this patch has been applied
- `firstAppliedAt` (number | null): Timestamp when the patch was first applied, or `null` if never applied
- `lastAppliedAt` (number | null): Timestamp when the patch was most recently applied, or `null` if never applied
- `currentlyApplied` (boolean): Whether this patch is currently active in the registry
- `undoCount` (number): Number of times this patch has been undone
- `rollbackCount` (number): Number of times this patch has been rolled back due to errors
- `averageDurationMs` (number | null): Average time to apply this patch in milliseconds, or `null` if no timing data available
- `sourcePath` (string | null): File path from patch metadata, or `null` if not provided
- `sourceHash` (string | null): Source code hash from patch metadata, or `null` if not provided
- `dependencies` (Array<string>): List of dependency identifiers from patch metadata, or empty array if not provided
- `historyEntries` (Array<PatchHistoryEntry>): Complete history of all operations involving this patch

**Example:**

```javascript
const wrapper = createRuntimeWrapper();

// Apply a patch with metadata
wrapper.applyPatch({
    kind: "script",
    id: "script:player_move",
    js_body: "return args[0] * 2;",
    metadata: {
        sourcePath: "/game/scripts/player_move.gml",
        sourceHash: "abc123def456",
        timestamp: Date.now(),
        dependencies: ["script:get_input", "script:apply_velocity"]
    }
});

// Update the same patch
wrapper.applyPatch({
    kind: "script",
    id: "script:player_move",
    js_body: "return args[0] * 3;"
});

// Get comprehensive diagnostics
const diagnostics = wrapper.getPatchDiagnostics("script:player_move");
console.log(`Patch: ${diagnostics.id}`);
console.log(`Applied ${diagnostics.applicationCount} times`);
console.log(`Currently active: ${diagnostics.currentlyApplied}`);
console.log(`Average apply time: ${diagnostics.averageDurationMs}ms`);
console.log(`Source: ${diagnostics.sourcePath}`);
console.log(`Dependencies: ${diagnostics.dependencies.join(", ")}`);
console.log(`History: ${diagnostics.historyEntries.length} events`);
```

**Use cases:**

- Debugging why a specific patch isn't behaving as expected
- Tracking which source file a runtime function came from
- Understanding patch dependencies for debugging cascade issues
- Monitoring patch application performance for specific scripts
- Building developer tooling that provides real-time patch insights
- Generating audit trails for patch operations during development

### `createWebSocketClient(options)`

Creates a WebSocket client for receiving live patches from a development server. The client automatically reconnects on connection loss and integrates with a runtime wrapper to apply patches.

**Options:**

- `url` (optional): WebSocket server URL. Default is `"ws://127.0.0.1:17890"`.
- `wrapper` (optional): Runtime wrapper instance. If provided, patches received over WebSocket are automatically applied.
- `onConnect` (optional): Callback invoked when the WebSocket connection opens.
- `onDisconnect` (optional): Callback invoked when the WebSocket connection closes.
- `onError` (optional): Callback `(error, context)` invoked on errors. Context is either `"connection"` or `"patch"`.
- `reconnectDelay` (optional): Milliseconds to wait before reconnecting after connection loss. Default is `800`. Set to `0` to disable reconnection.
- `autoConnect` (optional): When `true`, connects immediately. Default is `true`.
- `logger` (optional): Logger instance for structured diagnostic logging. See [Diagnostic Logging](#diagnostic-logging) for details.
- `patchQueue` (optional): Configuration for patch queuing and batching:
    - `enabled` (optional): When `true`, enables patch queuing. Default is `false`. Requires `wrapper`; otherwise queuing is automatically disabled.
    - `maxQueueSize` (optional): Maximum patches to buffer before forcing a flush. Default is `100`.
    - `flushIntervalMs` (optional): Time in milliseconds to wait before flushing queued patches. Default is `50`ms.

**Patch Queuing:**

When `patchQueue.enabled` is `true` **and** a `wrapper` is provided, incoming patches are buffered and flushed in batches rather than applied immediately. This provides several benefits:

- **Reduced overhead**: Multiple patches are applied as a single atomic batch operation
- **Improved throughput**: During rapid file changes, patches accumulate and are flushed together
- **Better reliability**: Patches are buffered during temporary processing delays
- **Automatic batching**: Leverages the existing `applyPatchBatch()` API for optimal performance

The queue automatically flushes when:

- The flush interval timer expires (default 50ms)
- The queue reaches `maxQueueSize` (default 100 patches)
- `disconnect()` is called
- `flushPatchQueue()` is called manually

**Example with Queuing:**

```javascript
const client = createWebSocketClient({
    wrapper,
    patchQueue: {
        enabled: true,
        maxQueueSize: 50,
        flushIntervalMs: 100
    }
});

// Patches arriving within 100ms are batched together
// Queue metrics track buffering behavior
const queueMetrics = client.getPatchQueueMetrics();
console.log(`Queued: ${queueMetrics.totalQueued}`);
console.log(`Flushed: ${queueMetrics.totalFlushed}`);
console.log(`Peak depth: ${queueMetrics.maxQueueDepth}`);
```

**Returns:** An object with the following methods:

#### `connect()`

Establishes a WebSocket connection to the server. Called automatically if `autoConnect` is `true`.

#### `disconnect()`

Closes the WebSocket connection and cancels any pending reconnection attempts.

#### `isConnected()`

Returns `true` if the WebSocket is currently connected, `false` otherwise.

#### `send(data)`

Sends data to the server. Data can be a string or an object (which will be JSON-stringified). Throws an error if not connected.

#### `getWebSocket()`

Returns the underlying WebSocket instance, or `null` if not connected. Useful for testing and advanced use cases.

#### `getConnectionMetrics()`

Returns a read-only snapshot of connection health metrics for diagnostics and monitoring. The returned object includes:

- `totalConnections`: Number of successful connections
- `totalDisconnections`: Number of disconnections
- `totalReconnectAttempts`: Number of automatic reconnection attempts
- `patchesReceived`: Total patches received over the connection
- `patchesApplied`: Total patches successfully applied
- `patchesFailed`: Total patches that failed to apply (includes validation failures and application errors)
- `lastConnectedAt`: Timestamp of the last successful connection (milliseconds since epoch), or `null` if never connected
- `lastDisconnectedAt`: Timestamp of the last disconnection (milliseconds since epoch), or `null` if never disconnected
- `lastPatchReceivedAt`: Timestamp when the last patch was received (milliseconds since epoch), or `null` if no patches received
- `lastPatchAppliedAt`: Timestamp when the last patch was successfully applied (milliseconds since epoch), or `null` if no patches applied
- `connectionErrors`: Number of connection-level errors
- `patchErrors`: Number of patch-level errors (validation failures, malformed payloads, and application errors)

**Example:**

```javascript
const client = createWebSocketClient({ wrapper });

// Later, check connection health
const metrics = client.getConnectionMetrics();
console.log(`Received ${metrics.patchesReceived} patches`);
console.log(`Applied ${metrics.patchesApplied} patches`);
console.log(`Failed ${metrics.patchesFailed} patches`);
console.log(
    `Success rate: ${((metrics.patchesApplied / metrics.patchesReceived) * 100).toFixed(1)}%`
);

if (metrics.lastPatchReceivedAt) {
    const timeSinceLastPatch = Date.now() - metrics.lastPatchReceivedAt;
    console.log(`Last patch received ${timeSinceLastPatch}ms ago`);
}
```

The metrics object is frozen to prevent accidental modification. Use these metrics for:

- Monitoring connection quality
- Debugging patch application failures
- Tracking hot-reload performance
- Building diagnostic dashboards
- Detecting connection issues

#### `resetConnectionMetrics()`

Resets all connection metrics to their initial state. This is useful for starting fresh metric collection in long-running development sessions or for testing scenarios that require clean metric baselines.

**Example:**

```javascript
const client = createWebSocketClient({ wrapper });

// Use client and accumulate metrics...
client.connect();

// Later, start a fresh monitoring period
client.resetConnectionMetrics();

const metrics = client.getConnectionMetrics();
console.log(metrics.patchesReceived); // 0
console.log(metrics.patchesApplied); // 0
console.log(metrics.lastConnectedAt); // null
```

**Use cases:**

- Starting fresh metric windows in long-running development sessions
- Resetting metrics between different development tasks
- Testing scenarios that require clean metric baselines
- Implementing sliding time-window metrics collection
- Isolating metrics for specific debugging sessions

**Note:** Resetting metrics does not affect the actual connection state. If the client is currently connected, it remains connected after calling `resetConnectionMetrics()`.

#### `getPatchQueueMetrics()`

Returns patch queue metrics if queuing is enabled, or `null` if queuing is disabled. The returned object includes:

- `totalQueued`: Total number of patches added to the queue
- `totalFlushed`: Total number of patches successfully flushed from the queue
- `totalDropped`: Number of patches dropped when the queue was full (oldest patches are dropped)
- `maxQueueDepth`: Peak queue depth observed during the session
- `flushCount`: Number of flush operations performed
- `lastFlushSize`: Number of patches in the most recent flush
- `lastFlushedAt`: Timestamp of the last flush operation (milliseconds since epoch), or `null` if never flushed

**Example:**

```javascript
const client = createWebSocketClient({
    wrapper,
    patchQueue: { enabled: true }
});

const metrics = client.getPatchQueueMetrics();
if (metrics) {
    console.log(`Queue depth: ${metrics.maxQueueDepth}`);
    console.log(`Flush rate: ${metrics.flushCount} flushes`);
    console.log(
        `Avg batch size: ${(metrics.totalFlushed / metrics.flushCount).toFixed(1)}`
    );
}
```

The metrics object is frozen to prevent accidental modification. Use these metrics for:

- Monitoring queue performance and efficiency
- Tuning `maxQueueSize` and `flushIntervalMs` parameters
- Detecting patch throughput bottlenecks
- Understanding batching behavior during development
- Diagnosing patch delivery issues

#### `flushPatchQueue()`

Manually flushes any queued patches immediately. Returns the number of patches flushed. Only applicable when patch queuing is enabled; returns `0` if queuing is disabled or the queue is empty.

**Example:**

```javascript
const client = createWebSocketClient({
    wrapper,
    patchQueue: { enabled: true, flushIntervalMs: 10000 }
});

// Force immediate flush before a critical operation
const flushed = client.flushPatchQueue();
console.log(`Flushed ${flushed} pending patches`);
```

**Use cases:**

- Forcing immediate patch application before switching contexts
- Ensuring all patches are applied before running tests
- Manually controlling flush timing in custom workflows
- Debugging queue behavior during development

**Note:** Resetting metrics does not affect the actual connection state. If the client is currently connected, it remains connected after calling `resetConnectionMetrics()`.

**Example Usage:**

```javascript
import {
    createRuntimeWrapper,
    createWebSocketClient,
    createLogger
} from "@gmloop/runtime-wrapper";

// Create logger for structured diagnostics
const logger = createLogger({
    level: "info",
    timestamps: true,
    prefix: "[gml-dev]"
});

// Create wrapper
const wrapper = createRuntimeWrapper({
    onPatchApplied: (patch, version) => {
        console.log(`Patch ${patch.id} applied at version ${version}`);
    }
});

// Create WebSocket client with logger integration
const client = createWebSocketClient({
    url: "ws://localhost:17890",
    wrapper,
    logger, // Enable structured logging for all WebSocket events
    onConnect: () => console.log("Connected to dev server"),
    onDisconnect: () => console.log("Disconnected from dev server"),
    onError: (error, context) => console.error(`Error (${context}):`, error)
});

// The logger will automatically log:
// - WebSocket connection/disconnection events
// - Reconnection attempts
// - Patch queue flush operations (when queuing is enabled)
// - Patch application timing
// - Transport latency for patches with timestamps

// Apply various patch types
wrapper.applyPatch({
    kind: "script",
    id: "script:calculate_damage",
    js_body: "return args[0] * 1.5;"
});

wrapper.applyPatch({
    kind: "event",
    id: "obj_player#Step",
    js_body: "this.x += 1;"
});

wrapper.applyPatch({
    kind: "closure",
    id: "closure:make_counter",
    js_body: "let count = 0; return () => ++count;"
});

const counter = wrapper.getClosure("closure:make_counter")();
console.log(counter()); // 1
console.log(counter()); // 2

// Client will automatically reconnect on connection loss
// Disconnect manually when done
// client.disconnect();
```

## Performance Monitoring

The runtime wrapper automatically tracks performance metrics for patch application, providing insight into hot-reload performance:

```javascript
const wrapper = createRuntimeWrapper({
    onPatchApplied: (patch, version) => {
        console.log(`✅ Applied patch ${patch.id} at version ${version}`);
    }
});

// Apply several patches
wrapper.applyPatch({ kind: "script", id: "script:a", js_body: "return 1;" });
wrapper.applyPatch({ kind: "script", id: "script:b", js_body: "return 2;" });
wrapper.applyPatch({
    kind: "event",
    id: "obj_test#Step",
    js_body: "this.x++;"
});

// Get detailed performance statistics
const stats = wrapper.getPatchStats();
console.log(`Total patches applied: ${stats.appliedPatches}`);
console.log(
    `Average patch time: ${stats.averagePatchDurationMs?.toFixed(2)}ms`
);
console.log(`Median (p50): ${stats.p50DurationMs?.toFixed(2)}ms`);
console.log(`90th percentile: ${stats.p90DurationMs?.toFixed(2)}ms`);
console.log(`99th percentile: ${stats.p99DurationMs?.toFixed(2)}ms`);
console.log(`Fastest patch: ${stats.fastestPatchMs}ms`);
console.log(`Slowest patch: ${stats.slowestPatchMs}ms`);
console.log(`Total time: ${stats.totalDurationMs}ms`);

// Get detailed history with timing for each patch
const history = wrapper.getPatchHistory();
history.forEach((entry) => {
    if (entry.action === "apply" && entry.durationMs !== undefined) {
        console.log(`${entry.patch.id}: ${entry.durationMs}ms`);
    }
});
```

Performance metrics help identify:

- Slow patch applications that may indicate complex transformations
- Performance regressions when updating the transpiler or patch logic
- Opportunities to optimize hot-reload performance
- Baseline metrics for integration testing
- Outliers through percentile analysis (p90, p99) that reveal edge cases

## Registry Lifecycle Hooks

The runtime wrapper provides a unified event system for tracking all registry changes through the `onChange` listener. This enables reactive patterns, debugging tools, and integration with external monitoring systems.

### Event Types

The `onChange` listener receives one of four event types:

#### `patch-applied`

Emitted when a patch is successfully applied to the registry.

```javascript
{
    type: "patch-applied",
    patch: Patch,         // The applied patch object
    version: number       // Registry version after application
}
```

#### `patch-undone`

Emitted when a patch is successfully undone via `wrapper.undo()`.

```javascript
{
    type: "patch-undone",
    patch: { kind, id },  // Metadata about the undone patch
    version: number       // Registry version after undo
}
```

#### `patch-rolled-back`

Emitted when a patch is applied but then automatically rolled back due to an error.

```javascript
{
    type: "patch-rolled-back",
    patch: Patch,         // The failed patch object
    version: number,      // Registry version after rollback
    error: string         // Error message that caused the rollback
}
```

**Note:** This event is only emitted when an actual rollback occurs (i.e., after a patch was applied and then failed). Validation failures that occur before patch application do not emit rollback events.

#### `registry-cleared`

Emitted when the entire registry is cleared via `wrapper.clearRegistry()`.

```javascript
{
    type: "registry-cleared",
    version: number       // New registry version after clearing
}
```

### Usage Example

```javascript
import { createRuntimeWrapper } from "@gmloop/runtime-wrapper";

const auditLog: Array<unknown> = [];

const wrapper = createRuntimeWrapper({
    onChange: (event) => {
        auditLog.push({
            timestamp: Date.now(),
            ...event
        });

        switch (event.type) {
            case "patch-applied":
                console.log(`✓ Applied ${event.patch.id} (v${event.version})`);
                break;
            case "patch-undone":
                console.log(`↶ Undone ${event.patch.id} (v${event.version})`);
                break;
            case "patch-rolled-back":
                console.error(`✗ Rollback ${event.patch.id}: ${event.error}`);
                break;
            case "registry-cleared":
                console.log(`⌧ Registry cleared (v${event.version})`);
                break;
        }
    }
});

// All registry changes trigger onChange events
wrapper.applyPatch({ kind: "script", id: "script:a", js_body: "return 1;" });
wrapper.applyPatch({ kind: "script", id: "script:b", js_body: "return 2;" });
wrapper.undo();
wrapper.clearRegistry();

console.log(`Audit log contains ${auditLog.length} events`);
```

### Integration Patterns

The lifecycle hooks enable several useful patterns:

**State synchronization:**

```javascript
const wrapper = createRuntimeWrapper({
    onChange: (event) => {
        // Sync registry state to external store
        if (event.type === "patch-applied") {
            stateManager.notify("patch", event.patch.id);
        }
    }
});
```

**Debugging and diagnostics:**

```javascript
const wrapper = createRuntimeWrapper({
    onChange: (event) => {
        // Log all changes for debugging
        debugLogger.trace("Registry change", event);

        // Emit metrics
        if (event.type === "patch-rolled-back") {
            metrics.increment("patch.rollback");
        }
    }
});
```

**UI updates:**

```javascript
const wrapper = createRuntimeWrapper({
    onChange: (event) => {
        // Update HUD overlay in browser
        updateHUD({
            lastEvent: event.type,
            version: event.version,
            timestamp: Date.now()
        });
    }
});
```

## Error Analytics

The runtime wrapper provides comprehensive error tracking and analytics to help developers debug hot-reload issues during development. Error analytics categorize failures, detect patterns, and provide statistical insights into patch application problems.

### Error Categories

Errors are categorized by the phase in which they occur:

- **validation**: Structural or semantic validation failures before application
- **shadow**: Errors detected during shadow registry testing
- **application**: Errors that occur during actual patch application
- **rollback**: Errors encountered during automatic rollback operations

### `getErrorAnalytics()`

Returns comprehensive error statistics and patterns across all patches.

**Returns:** A `PatchErrorAnalytics` object with:

- `totalErrors` (number): Total number of errors recorded
- `errorsByCategory` (Record<PatchErrorCategory, number>): Error counts grouped by category
- `errorsByKind` (Record<PatchKind, number>): Error counts grouped by patch type (script, event, closure)
- `uniquePatchesWithErrors` (number): Number of unique patch IDs that have encountered errors
- `mostProblematicPatches` (Array<{ patchId: string; errorCount: number }>): Top 10 patches by error count
- `recentErrors` (Array<PatchErrorOccurrence>): Last 20 error occurrences with full details
- `errorRate` (number): Ratio of errors to successful patch applications

**Example:**

```javascript
const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

// Apply several patches, some failing
wrapper.applyPatch({ kind: "script", id: "script:good", js_body: "return 1;" });

try {
    wrapper.applyPatch({
        kind: "script",
        id: "script:bad_syntax",
        js_body: "return {{ invalid"
    });
} catch {
    // Error is automatically recorded
}

// Get comprehensive error analytics
const analytics = wrapper.getErrorAnalytics();

console.log(`Total errors: ${analytics.totalErrors}`);
console.log(`Error rate: ${(analytics.errorRate * 100).toFixed(1)}%`);
console.log(`Shadow errors: ${analytics.errorsByCategory.shadow}`);
console.log(`Unique problematic patches: ${analytics.uniquePatchesWithErrors}`);

// Identify most problematic patches
for (const { patchId, errorCount } of analytics.mostProblematicPatches) {
    console.log(`  ${patchId}: ${errorCount} errors`);
}

// Review recent errors
for (const error of analytics.recentErrors.slice(-5)) {
    console.log(`[${error.category}] ${error.patchId}: ${error.error}`);
}
```

### `getErrorsForPatch(id)`

Returns detailed error summary for a specific patch ID.

**Parameters:**

- `id` (string): The patch identifier to get error information for

**Returns:** A `PatchErrorSummary` object or `null` if the patch has no errors:

- `patchId` (string): The patch identifier
- `totalErrors` (number): Total number of errors for this patch
- `errorsByCategory` (Record<PatchErrorCategory, number>): Error counts by category
- `firstErrorAt` (number): Timestamp of the first error occurrence
- `lastErrorAt` (number): Timestamp of the most recent error occurrence
- `mostRecentError` (string): Error message from the most recent failure
- `uniqueErrorMessages` (number): Number of distinct error messages encountered

**Example:**

```javascript
const wrapper = createRuntimeWrapper({ validateBeforeApply: true });

// Apply the same problematic patch multiple times
for (let i = 0; i < 5; i++) {
    try {
        wrapper.applyPatch({
            kind: "script",
            id: "script:flaky",
            js_body: "return {{ bad syntax"
        });
    } catch {
        // Expected
    }
}

// Get detailed error summary for this specific patch
const summary = wrapper.getErrorsForPatch("script:flaky");

if (summary) {
    console.log(`Patch: ${summary.patchId}`);
    console.log(`Total failures: ${summary.totalErrors}`);
    console.log(
        `First failed: ${new Date(summary.firstErrorAt).toISOString()}`
    );
    console.log(`Last failed: ${new Date(summary.lastErrorAt).toISOString()}`);
    console.log(`Error: ${summary.mostRecentError}`);
    console.log(`Unique error messages: ${summary.uniqueErrorMessages}`);
    console.log(
        `Category breakdown: shadow=${summary.errorsByCategory.shadow}, validation=${summary.errorsByCategory.validation}`
    );
}
```

### `clearErrorHistory()`

Clears all error history records, resetting error analytics to initial state. This is useful for starting fresh error tracking in long-running development sessions or for testing scenarios that require clean baselines.

**Example:**

```javascript
const wrapper = createRuntimeWrapper();

// Accumulate some errors during development
try {
    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return {{ bad"
    });
} catch {
    // Expected
}

console.log(wrapper.getErrorAnalytics().totalErrors); // 1

// Start a fresh monitoring period
wrapper.clearErrorHistory();

console.log(wrapper.getErrorAnalytics().totalErrors); // 0
```

**Note:** Clearing error history does not affect patch history or the registry state. Only error tracking records are removed.

### Error Analytics Use Cases

**Debugging recurring failures:**

```javascript
const analytics = wrapper.getErrorAnalytics();

if (analytics.errorRate > 0.1) {
    console.warn("High error rate detected!");

    for (const {
        patchId,
        errorCount
    } of analytics.mostProblematicPatches.slice(0, 3)) {
        const summary = wrapper.getErrorsForPatch(patchId);
        console.log(`\nProblematic patch: ${patchId} (${errorCount} errors)`);
        console.log(`Most recent error: ${summary.mostRecentError}`);
    }
}
```

**Monitoring development workflow:**

```javascript
const wrapper = createRuntimeWrapper({
    validateBeforeApply: true,
    onChange: (event) => {
        if (event.type === "patch-applied") {
            const analytics = wrapper.getErrorAnalytics();

            // Update HUD overlay
            updateDevHUD({
                successRate: (1 - analytics.errorRate) * 100,
                recentErrors: analytics.recentErrors.length,
                problematicPatches: analytics.uniquePatchesWithErrors
            });
        }
    }
});
```

**Building diagnostic dashboards:**

```javascript
function generateErrorReport() {
    const analytics = wrapper.getErrorAnalytics();

    return {
        summary: {
            totalErrors: analytics.totalErrors,
            errorRate: `${(analytics.errorRate * 100).toFixed(1)}%`,
            affectedPatches: analytics.uniquePatchesWithErrors
        },
        byCategory: analytics.errorsByCategory,
        byKind: analytics.errorsByKind,
        topProblems: analytics.mostProblematicPatches.slice(0, 5),
        recentFailures: analytics.recentErrors.slice(-10).map((e) => ({
            patch: e.patchId,
            category: e.category,
            error: e.error,
            when: new Date(e.timestamp).toISOString()
        }))
    };
}
```

## Status

The module implements core patch application, diagnostic capabilities, performance instrumentation, WebSocket integration, registry lifecycle hooks, comprehensive error analytics, and structured development logging. The error tracking system provides developers with detailed insights into hot-reload failures, enabling rapid identification and resolution of development issues. The diagnostic logger provides real-time visibility into patch operations during development.

## Diagnostic Logging

The runtime wrapper includes a configurable diagnostic logger for debugging hot-reload operations. The logger provides pretty-printed console output with emoji indicators, timestamps, and performance timing.

### `createLogger(options)`

Creates a diagnostic logger for runtime wrapper operations.

**Options:**

- `level` (optional): Minimum log level to output. Options: `"silent"`, `"error"`, `"warn"`, `"info"`, `"debug"`. Default is `"error"`.
- `prefix` (optional): Prefix to prepend to all log messages. Default is `"[hot-reload]"`.
- `timestamps` (optional): Whether to include timestamps in log output. Default is `false`.
- `styled` (optional): Whether to use colors and emoji in console output. Default is `true`.
- `console` (optional): Custom console-like object for output. Useful for testing or custom log routing.

**Returns:** A `Logger` object with methods for logging patch lifecycle events, validation errors, WebSocket events, and general messages.

**Example:**

```javascript
import {
    createLogger,
    createChangeEventLogger,
    createRuntimeWrapper
} from "@gmloop/runtime-wrapper";

// Create logger with info level for development
const logger = createLogger({
    level: "info",
    timestamps: true,
    prefix: "[dev-reload]"
});

// Integrate with runtime wrapper onChange hook
const wrapper = createRuntimeWrapper({
    onChange: createChangeEventLogger(logger)
});

// Apply patches - logger will automatically output diagnostic info
wrapper.applyPatch({
    kind: "script",
    id: "script:player_move",
    js_body: "return args[0] * 2;"
});
// Output: [dev-reload] ✅ Patch script:player_move applied in 2ms (v1)

// Manual logging
logger.info("Starting hot reload session");
logger.debug("Detailed diagnostic information");
logger.warn("Shadow validation took longer than expected");
logger.error("Failed to apply patch");

// Change log level dynamically
logger.setLevel("debug");
```

**Logger Methods:**

The logger provides specialized methods for different types of hot-reload events:

- `patchApplied(patch, version, durationMs?)` - Log successful patch application
- `patchUndone(patchId, version)` - Log patch undo operation
- `patchRolledBack(patch, version, error)` - Log patch rollback due to error
- `registryCleared(version)` - Log registry clear operation
- `validationError(patchId, error)` - Log patch validation failure
- `shadowValidationFailed(patchId, error)` - Log shadow validation failure
- `websocketConnected(url)` - Log WebSocket connection
- `websocketDisconnected(reason?)` - Log WebSocket disconnection
- `websocketReconnecting(attempt, delayMs)` - Log reconnection attempt
- `websocketError(error)` - Log WebSocket error
- `patchQueueFlushed(count, durationMs)` - Log patch queue flush
- `patchQueued(patchId, queueDepth)` - Log patch added to queue
- `info(message, ...args)` - Log general info message
- `warn(message, ...args)` - Log warning message
- `error(message, ...args)` - Log error message
- `debug(message, ...args)` - Log debug message
- `setLevel(level)` - Update current log level
- `getLevel()` - Get current log level

### `createChangeEventLogger(logger)`

Creates a logger function that integrates with the runtime wrapper's `onChange` hook. This function listens to registry change events and automatically logs them using the provided logger.

**Parameters:**

- `logger`: A `Logger` instance created with `createLogger()`

**Returns:** A function that can be passed as the `onChange` option when creating a runtime wrapper.

**Example:**

```javascript
const logger = createLogger({ level: "info" });
const eventLogger = createChangeEventLogger(logger);

const wrapper = createRuntimeWrapper({
    onChange: eventLogger // Automatically log all registry changes
});
```

**Log Level Priority:**

Log levels are ordered from least to most verbose:

1. `silent` - No output
2. `error` - Only errors
3. `warn` - Errors and warnings
4. `info` - Errors, warnings, and informational messages
5. `debug` - All messages including detailed diagnostics

**Production Usage:**

For production builds, set the log level to `"silent"` or `"error"` to minimize console noise:

```javascript
const logger = createLogger({
    level: process.env.NODE_ENV === "production" ? "error" : "debug"
});
```

**Performance Impact:**

The logger is designed to have minimal performance impact. When a log level is configured, messages below that level are completely skipped without string formatting or console calls. Enable `debug` level only during active development to avoid potential performance overhead in long-running sessions.

## Performance Characteristics

The runtime wrapper is optimized for minimal overhead during hot-reload sessions. Understanding its performance profile helps maintain fast iteration times:

### Memory Management

- **Undo Stack**: Automatically limited to 50 snapshots by default (configurable via `maxUndoStackSize`). Each snapshot stores only the single previous function for a specific patch ID, not the entire registry. Set to 0 for unlimited (not recommended for long sessions).

- **Error History**: Automatically limited to 100 error records by default (configurable via `maxErrorHistorySize`). Oldest errors are discarded when the limit is reached, preventing unbounded growth during error-heavy development sessions. Set to 0 for unlimited (not recommended for long sessions).

- **Patch Queue**: Uses a head-pointer strategy with periodic compaction (at 2× `maxQueueSize`) to amortize array slice operations. This reduces allocation pressure during high-throughput patch bursts.

- **Dependency Lookup**: Creates a Set of all patch IDs on each validation call. For typical registries with hundreds of patches, this is negligible. For very large projects (thousands of patches), consider batching patch applications to reduce validation overhead.

### Patch Application Latency

Typical patch application times (measured on modern hardware):

- **Simple script patch**: < 1ms (median)
- **Event patch with runtime binding**: 1-3ms (median)
- **Shadow validation (when enabled)**: +0.5-2ms overhead per patch
- **Batch application (10 patches)**: 5-15ms total

Performance tips:

1. **Batch patches when possible** - Use `applyPatchBatch()` instead of multiple `applyPatch()` calls to reduce per-patch overhead and enable atomic rollback.

2. **Enable shadow validation judiciously** - The `validateBeforeApply` option catches syntax errors before touching the real registry but adds ~50-100% overhead to patch application time. Enable only during active debugging.

3. **Monitor error history size** - In error-heavy sessions, consider lowering `maxErrorHistorySize` (e.g., to 50) to reduce memory footprint if full error analytics aren't needed.

4. **Profile with `getPatchStats()`** - Use timing percentiles (p50, p90, p99) to identify slow patches and optimize their JavaScript bodies.

### WebSocket and Network

- **Patch Queue Batching**: Patches are queued and flushed every 50ms (configurable via `flushIntervalMs`) to reduce WebSocket message overhead. Batches flush immediately when the queue reaches `maxQueueSize`.

- **Pending Patches**: Before runtime readiness, patches are buffered with a sliding window (oldest discarded when `maxPendingPatches` is reached) to prevent memory bloat during slow GameMaker initialization.

- **Runtime Readiness Polling**: Checks for GameMaker globals (`g_pBuiltIn`, `JSON_game`) every 50ms until ready. Polling stops automatically after the first successful check to eliminate overhead.

### Recommended Limits for Long Sessions

For development sessions lasting hours with frequent errors or many patches:

```javascript
const wrapper = createRuntimeWrapper({
    maxUndoStackSize: 30, // Reduce undo depth if not heavily used
    maxErrorHistorySize: 50, // Lower if full error analytics not needed
    validateBeforeApply: false // Disable unless actively debugging syntax errors
});
```

For aggressive memory conservation:

```javascript
const wrapper = createRuntimeWrapper({
    maxUndoStackSize: 10, // Minimal undo capability
    maxErrorHistorySize: 20, // Keep only recent errors
    validateBeforeApply: false
});
```

## Architecture and Interface Segregation

### WebSocket Client Interfaces

The `RuntimeWebSocketClient` interface follows the Interface Segregation Principle (ISP) by splitting responsibilities into role-focused interfaces. This allows consumers to depend only on the capabilities they need:

- **`WebSocketConnectionLifecycle`** - Connection management (`connect`, `disconnect`, `isConnected`)
- **`WebSocketMessageSender`** - Message transmission (`send`)
- **`WebSocketInstanceProvider`** - WebSocket access (`getWebSocket`)
- **`WebSocketMetricsCollector`** - Metrics tracking (`getConnectionMetrics`, `resetConnectionMetrics`)
- **`WebSocketPatchQueueManager`** - Patch queue management (`getPatchQueueMetrics`, `flushPatchQueue`)

### Browser-Compatible Core Helpers

The runtime wrapper ships into the GameMaker HTML5 build as part of the hot-reload runtime bundle. Because that bundle runs inside a browser environment, it cannot statically resolve workspace-import specifiers such as `@gmloop/core`. The runtime wrapper therefore carries its own miniature helper module (`src/runtime/runtime-core-helpers.ts`) that reimplements just the predicates and utilities (`isErrorLike`, `isNonEmptyString`, `cloneObjectEntries`, `areNumbersApproximatelyEqual`, `toArray`) required by `runtime-wrapper.ts`, `patch-utils.ts`, and the WebSocket client. Keeping this helper module narrow avoids bundling the entire `@gmloop/core` namespace into the injected assets while still letting the runtime wrapper reuse well-tested core-like helpers.

**Example - Depending on minimal interfaces:**

```javascript
// Consumer that only needs lifecycle control
function setupConnection(client: WebSocketConnectionLifecycle) {
    client.connect();
    // Only has access to connect/disconnect/isConnected
}

// Consumer that only needs to send messages
function broadcastPatch(sender: WebSocketMessageSender, patch: unknown) {
    sender.send(patch);
    // Only has access to send
}

// Consumer that needs full capabilities
function manageWebSocket(client: RuntimeWebSocketClient) {
    client.connect();
    client.send({ type: "ping" });
    console.log(client.getConnectionMetrics());
    // Has access to all methods
}
```

This design provides several benefits:

1. **Explicit dependencies** - Function signatures clearly communicate what capabilities they require
2. **Easier testing** - Mock objects only need to implement the minimal interface
3. **Better encapsulation** - Consumers can't accidentally call methods they shouldn't use
4. **Future flexibility** - New implementations can provide subsets of functionality without full compliance

The same pattern is applied to other major interfaces in this module:

- **`RuntimeWrapper`** extends `PatchApplicator`, `PatchUndoController`, `PatchHistoryReader`, `RegistryReader`, `RegistryMutator`, `RuntimeMetrics`, `RegistryDiagnostics`, and `ErrorAnalytics`
- **`Logger`** extends `PatchLifecycleLogger`, `RegistryLifecycleLogger`, `WebSocketLogger`, `GeneralLogger`, and `LoggerConfiguration`
