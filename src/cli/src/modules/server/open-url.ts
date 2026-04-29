import { spawn } from "node:child_process";

/**
 * Open a URL in the system default browser.
 */
export function openUrlInDefaultBrowser(url: string): void {
    if (process.platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        return;
    }

    if (process.platform === "win32") {
        spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
        return;
    }

    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}
