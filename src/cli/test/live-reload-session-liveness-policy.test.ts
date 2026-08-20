import assert from "node:assert/strict";
import { test } from "node:test";

import { createStatusUrl, createWebSocketUrl } from "../src/modules/live-reload/config.js";
import { evaluateLiveReloadSessionLiveness } from "../src/modules/live-reload/session-liveness-policy.js";
import type { LiveReloadRegisteredSession } from "../src/modules/live-reload/session-registry.js";

function createSession(overrides: Partial<LiveReloadRegisteredSession> = {}): LiveReloadRegisteredSession {
    return {
        lastHeartbeatAt: Date.now(),
        processId: 1234,
        projectRoot: "/tmp/project",
        runtimeUrl: null,
        sessionId: "session-1",
        startSource: "cli",
        status: "running",
        statusHost: "127.0.0.1",
        statusPort: 50_001,
        statusUrl: createStatusUrl("127.0.0.1", 50_001),
        watchedRoot: "/tmp/project",
        websocketHost: "127.0.0.1",
        websocketPort: 50_002,
        websocketUrl: createWebSocketUrl("127.0.0.1", 50_002),
        yypPath: null,
        ...overrides
    };
}

void test("evaluateLiveReloadSessionLiveness rejects a non-object status payload", () => {
    assert.equal(evaluateLiveReloadSessionLiveness(createSession(), null), false);
    assert.equal(evaluateLiveReloadSessionLiveness(createSession(), "ok"), false);
    assert.equal(evaluateLiveReloadSessionLiveness(createSession(), undefined), false);
});

void test("evaluateLiveReloadSessionLiveness treats sessions without an identity as alive on any object payload", () => {
    const session = createSession({ processId: null, sessionId: undefined });
    assert.equal(evaluateLiveReloadSessionLiveness(session, {}), true);
    assert.equal(evaluateLiveReloadSessionLiveness(session, { liveReloadSession: null }), true);
});

void test("evaluateLiveReloadSessionLiveness rejects a payload missing the identity block", () => {
    const session = createSession();
    assert.equal(evaluateLiveReloadSessionLiveness(session, {}), false);
    assert.equal(evaluateLiveReloadSessionLiveness(session, { liveReloadSession: null }), false);
});

void test("evaluateLiveReloadSessionLiveness rejects an identity mismatch on any field", () => {
    const session = createSession();
    const baseIdentity = {
        processId: session.processId,
        projectRoot: session.projectRoot,
        sessionId: session.sessionId
    };

    assert.equal(
        evaluateLiveReloadSessionLiveness(session, {
            liveReloadSession: { ...baseIdentity, sessionId: "different-session" }
        }),
        false
    );
    assert.equal(
        evaluateLiveReloadSessionLiveness(session, {
            liveReloadSession: { ...baseIdentity, processId: 9999 }
        }),
        false
    );
    assert.equal(
        evaluateLiveReloadSessionLiveness(session, {
            liveReloadSession: { ...baseIdentity, projectRoot: "/tmp/other" }
        }),
        false
    );
});

void test("evaluateLiveReloadSessionLiveness accepts an exact identity match", () => {
    const session = createSession();

    assert.equal(
        evaluateLiveReloadSessionLiveness(session, {
            liveReloadSession: {
                processId: session.processId,
                projectRoot: session.projectRoot,
                sessionId: session.sessionId
            }
        }),
        true
    );
});
