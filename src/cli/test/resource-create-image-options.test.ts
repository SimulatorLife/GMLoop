import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildCreateImageResultPayload,
    type CreateImageRawOptions,
    parseCreateImageOptions,
    parsePositiveIntegerOption
} from "../src/commands/resource/create-image-options.js";

void describe("parsePositiveIntegerOption", () => {
    void it("accepts positive integer strings", () => {
        assert.strictEqual(parsePositiveIntegerOption("1", "width"), 1);
        assert.strictEqual(parsePositiveIntegerOption("64", "width"), 64);
        assert.strictEqual(parsePositiveIntegerOption("1024", "width"), 1024);
    });

    void it("rejects zero with the documented error format", () => {
        assert.throws(
            () => parsePositiveIntegerOption("0", "width"),
            (error: unknown) =>
                error instanceof Error && error.message === 'Invalid width: "0". Must be a positive integer.'
        );
    });

    void it("rejects negative values", () => {
        assert.throws(
            () => parsePositiveIntegerOption("-5", "height"),
            (error: unknown) =>
                error instanceof Error && error.message === 'Invalid height: "-5". Must be a positive integer.'
        );
    });

    void it("rejects non-numeric strings", () => {
        assert.throws(
            () => parsePositiveIntegerOption("abc", "checker size"),
            (error: unknown) =>
                error instanceof Error && error.message === 'Invalid checker size: "abc". Must be a positive integer.'
        );
    });

    void it("rejects empty strings", () => {
        assert.throws(
            () => parsePositiveIntegerOption("", "width"),
            (error: unknown) =>
                error instanceof Error && error.message === 'Invalid width: "". Must be a positive integer.'
        );
    });

    void it("surfaces the supplied option name in the error message", () => {
        assert.throws(() => parsePositiveIntegerOption("nope", "checker size"), /Invalid checker size: "nope"/);
    });
});

void describe("parseCreateImageOptions", () => {
    const sampleRawOptions: CreateImageRawOptions = {
        checkerSize: "8",
        color: "red",
        color2: "white",
        height: "32",
        pattern: "solid",
        width: "16"
    };

    void it("coerces every numeric flag into a typed number", () => {
        const request = parseCreateImageOptions(sampleRawOptions);

        assert.deepEqual(request, {
            checkerSize: 8,
            color: "red",
            color2: "white",
            height: 32,
            pattern: "solid",
            width: 16
        });
    });

    void it("propagates numeric validation failures from the underlying helper", () => {
        assert.throws(
            () =>
                parseCreateImageOptions({
                    ...sampleRawOptions,
                    width: "0"
                }),
            /Invalid width: "0"/
        );

        assert.throws(
            () =>
                parseCreateImageOptions({
                    ...sampleRawOptions,
                    height: "abc"
                }),
            /Invalid height: "abc"/
        );

        assert.throws(
            () =>
                parseCreateImageOptions({
                    ...sampleRawOptions,
                    checkerSize: "-1"
                }),
            /Invalid checker size: "-1"/
        );
    });

    void it("preserves color and pattern strings untouched", () => {
        const request = parseCreateImageOptions({
            checkerSize: "4",
            color: "#00FF00",
            color2: "blue",
            height: "8",
            pattern: "checkerboard",
            width: "8"
        });

        assert.strictEqual(request.color, "#00FF00");
        assert.strictEqual(request.color2, "blue");
        assert.strictEqual(request.pattern, "checkerboard");
    });
});

void describe("buildCreateImageResultPayload", () => {
    const request = {
        checkerSize: 4,
        color: "red",
        color2: "white",
        height: 32,
        pattern: "solid" as const,
        width: 16
    };

    void it("resolves relative output paths against the current working directory", () => {
        const payload = buildCreateImageResultPayload(request, "tmp/placeholder.png");

        assert.ok(payload.payload.outputPath.endsWith("tmp/placeholder.png"));
        assert.strictEqual(payload.command, "resource create-image");
        assert.strictEqual(payload.ok, true);
    });

    void it("preserves the request fields in the payload", () => {
        const payload = buildCreateImageResultPayload(request, "tmp/placeholder.png");

        assert.strictEqual(payload.payload.width, 16);
        assert.strictEqual(payload.payload.height, 32);
        assert.strictEqual(payload.payload.color, "red");
        assert.strictEqual(payload.payload.color2, "white");
        assert.strictEqual(payload.payload.pattern, "solid");
        assert.strictEqual(payload.payload.checkerSize, 4);
    });
});
