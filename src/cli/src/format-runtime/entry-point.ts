/**
 * Resolve the filesystem path to the `@gmloop/format` workspace's Prettier
 * plugin entry point.
 *
 * The CLI registers the format workspace as a Prettier plugin at runtime.
 * Prettier accepts a plugin path (not a module object), so callers need the
 * resolved file path rather than an imported module reference.
 *
 * Resolution uses Node's native ESM resolver (`import.meta.resolve`) against
 * the workspace's public `./prettier-plugin` subpath export. The format
 * workspace owns its own entry-point layout; the CLI only needs to know the
 * name of the subpath, not the internal file location. This keeps the CLI
 * and the format workspace decoupled: the workspace can rename or relocate
 * its entry point without touching the CLI.
 */
import { fileURLToPath } from "node:url";

const FORMAT_PRETTIER_PLUGIN_SUBPATH = "@gmloop/format/prettier-plugin";

/**
 * Resolve the absolute filesystem path to the `@gmloop/format` package's
 * Prettier plugin entry file.
 *
 * The returned path is suitable for passing to APIs that expect a Prettier
 * plugin file path (for example, Prettier's `plugins` option).
 */
export function resolveFormatEntryPoint(): string {
    const pluginEntryUrl = import.meta.resolve(FORMAT_PRETTIER_PLUGIN_SUBPATH);
    return fileURLToPath(pluginEntryUrl);
}
