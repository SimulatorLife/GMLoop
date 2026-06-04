import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { probeStdioMcpServer } from "../src/modules/game-maker-cli/stdio-mcp-server.js";

/**
 * Regression tests for JSON-RPC payload validation in `probeStdioMcpServer`.
 *
 * Verifies that the function correctly rejects or ignores malformed JSON-RPC
 * payloads sent by a mock MCP server, preventing malformed data from entering
 * the message queue.  These payloads include:
 *
 * - null / undefined top-level values
 * - Primitive values (strings, numbers, booleans)
 * - Arrays
 * - Valid JSON objects missing the required "jsonrpc" field
 * - Non-string "jsonrpc" values
 *
 * Without the validation, any of these could be pushed to `pendingMessages`
 * and cause downstream type errors when accessing properties like `message.id`
 * or `message.result`.
 */
void test("probeStdioMcpServer rejects null JSON payload", async () => {
    await withMalformedServer(String.raw`process.stdout.write('null\n');`);
});

void test("probeStdioMcpServer rejects primitive number JSON payload", async () => {
    await withMalformedServer(String.raw`process.stdout.write('42\n');`);
});

void test("probeStdioMcpServer rejects primitive string JSON payload", async () => {
    await withMalformedServer(String.raw`process.stdout.write('"hello"\n');`);
});

void test("probeStdioMcpServer rejects boolean JSON payload", async () => {
    await withMalformedServer(String.raw`process.stdout.write('true\n');`);
});

void test("probeStdioMcpServer rejects array JSON payload", async () => {
    await withMalformedServer(String.raw`process.stdout.write('[{"jsonrpc":"2.0","id":1}]\n');`);
});

void test("probeStdioMcpServer rejects object without jsonrpc field", async () => {
    await withMalformedServer(String.raw`process.stdout.write('{"method":"foo"}\n');`);
});

void test("probeStdioMcpServer rejects object with wrong jsonrpc version", async () => {
    await withMalformedServer(String.raw`process.stdout.write('{"jsonrpc":"1.0","id":1,"result":{}}\n');`);
});

void test("probeStdioMcpServer accepts valid JSON-RPC initialize response", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcp-malformed-accept-"));
    try {
        const scriptPath = path.join(root, "valid.mjs");
        // Using template literal to avoid escaping backslashes
        const scriptContent = String.raw`import { stdin } from 'node:process';
stdin.setEncoding('utf8');
stdin.on('data', () => {});
process.stdout.write('null\n');
process.stdout.write('42\n');
process.stdout.write('{"method":"foo"}\n');
process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"test","version":"1.0.0"}}}\n');
process.stdout.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
process.stdout.write('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n');
`;
        await writeFile(scriptPath, scriptContent, "utf8");

        const result = await probeStdioMcpServer({
            args: [scriptPath],
            command: process.execPath,
            cwd: root,
            displayName: "valid",
            timeoutMs: 2000
        });

        assert.equal(result.serverName, "test");
        assert.equal(result.serverVersion, "1.0.0");
        assert.equal(result.tools.length, 0);
    } finally {
        await rm(root, { force: true, recursive: true });
    }
});

/**
 * Helper: spawn a process that writes `junkLines` to stdout before hanging,
 * then verify that `probeStdioMcpServer` times out (because no valid JSON-RPC
 * response was sent) rather than crashing on the malformed payload.
 */
async function withMalformedServer(junkLines: string): Promise<void> {
    const root = await mkdtemp(path.join(os.tmpdir(), "mcp-malformed-"));
    try {
        const scriptPath = path.join(root, "malformed.mjs");
        // Build the script content directly with the junkLines embedded
        const scriptContent = String.raw`import { stdin } from 'node:process';
stdin.setEncoding('utf8');
stdin.on('data', () => {});
${junkLines}
await new Promise(() => {});
`;
        await writeFile(scriptPath, scriptContent, "utf8");

        // Should time out waiting for a valid JSON-RPC response,
        // not throw due to malformed payload processing.
        await assert.rejects(
            probeStdioMcpServer({
                args: [scriptPath],
                command: process.execPath,
                cwd: root,
                displayName: "malformed",
                timeoutMs: 500
            }),
            /Timed out/
        );
    } finally {
        await rm(root, { force: true, recursive: true });
    }
}
