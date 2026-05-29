import fs from "node:fs/promises";

import { HOT_RELOAD_MARKER_END, HOT_RELOAD_MARKER_START } from "./config.js";

export interface InjectLiveReloadBootstrapOptions {
    indexHtmlPath: string;
    bootstrapScriptSrc: string;
    force?: boolean;
}

function buildLiveReloadBootstrapSnippet(bootstrapScriptSrc: string): string {
    return [
        HOT_RELOAD_MARKER_START,
        `<script type="module" src="${bootstrapScriptSrc}"></script>`,
        HOT_RELOAD_MARKER_END
    ].join("\n");
}

export async function injectLiveReloadBootstrap({
    indexHtmlPath,
    bootstrapScriptSrc,
    force = false
}: InjectLiveReloadBootstrapOptions): Promise<boolean> {
    const contents = await fs.readFile(indexHtmlPath, "utf8");
    const snippet = buildLiveReloadBootstrapSnippet(bootstrapScriptSrc);
    const existingStart = contents.indexOf(HOT_RELOAD_MARKER_START);
    const existingEnd = contents.indexOf(HOT_RELOAD_MARKER_END);

    if (!force && existingStart !== -1 && existingEnd !== -1) {
        return false;
    }

    const nextContents =
        existingStart !== -1 && existingEnd !== -1
            ? (() => {
                  const endOffset = existingEnd + HOT_RELOAD_MARKER_END.length;
                  return `${contents.slice(0, existingStart)}${snippet}${contents.slice(endOffset)}`;
              })()
            : (() => {
                  const closingBodyIndex = contents.search(/<\/body\s*>/i);
                  if (closingBodyIndex === -1) {
                      return `${contents}\n${snippet}\n`;
                  }

                  return `${contents.slice(0, closingBodyIndex)}${snippet}\n${contents.slice(closingBodyIndex)}`;
              })();

    await fs.writeFile(indexHtmlPath, nextContents, "utf8");
    return true;
}

export const __test__ = Object.freeze({
    buildLiveReloadBootstrapSnippet
});
