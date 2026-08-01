# CannonFather HTML5 runtime investigation

## Verified GMLoop behavior

The watch command now bounds parser-heavy startup work, releases ANTLR
prediction state for large and periodic parses, and keeps its startup cache to
source text plus dependency metadata instead of retaining project ASTs. The
startup metadata pass also uses lexer-owned function-name discovery and source
directive macro extraction, so it does not parse the same file once merely to
prepare the later scan. Initial dependency scanning uses a metadata-only
coordinator path; runtime JavaScript is emitted only for live file changes.

The HTML5 runtime wrapper was verified with a CannonFather watch target:
the static runtime server started, the wrapper connected to the patch
WebSocket, and a source edit produced a delivered patch with no GMLoop errors.

The full native HTML5 build also now completes through Igor. The first compiler
failure was a GameMaker builtin-name collision in `RenderBuffer`; renaming its
local variables removed that target-specific compiler error without changing
the buffer logic. The first browser failure then mapped to `scr_get_uvs`,
which treated every nonnegative real—including sprite asset IDs—as a texture
pointer. The source now resolves sprite assets before texture pointers, while
numeric texture-page handles retain the existing full-page UV defaults.

After rebuilding and preparing the generated output, the game rendered its
playable scene in the browser with a live canvas and no console errors. The
wrapper status reported connected clients, a delivered patch, and zero GMLoop
or runtime errors.

## Remaining CannonFather limitation

The full CannonFather project contains thousands of asset directories and
hundreds of GML resources. Its complete dependency metadata scan remains CPU
intensive because each resource must still be parsed to build accurate symbol
and reference relationships. The runtime and status servers now start before
that scan, but a large synchronous parse can temporarily delay HTTP/browser
responses until the current file completes.

The remaining compatibility surface should still be exercised as additional
rooms and gameplay paths are reached: the native HTML5 runtime has APIs whose
behavior differs from desktop, and this investigation verified the initial
playable scene rather than every optional debug/export path. The full-project
watcher now exposes its servers before the global directory walk and keeps
directory/parser concurrency bounded, but its initial dependency index still
performs synchronous AST parsing for each GML file; large resources can delay
individual status responses while one parse is running. Watching the relevant
source subtree (or loading the prepared HTML5 output directly) avoids that
startup delay while preserving live patches for the watched files. The fixes
are source-level GameMaker changes, so desktop/macOS behavior is preserved by
the same local-variable and handle-dispatch logic.
