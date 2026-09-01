import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSolidColorPng, parseColor } from "../src/project-resources/create-image.js";

void describe("Color parser", () => {
    void it("correctly parses common color names", () => {
        assert.deepEqual(parseColor("red"), { r: 255, g: 0, b: 0, a: 255 });
        assert.deepEqual(parseColor("green"), { r: 0, g: 255, b: 0, a: 255 });
        assert.deepEqual(parseColor("blue"), { r: 0, g: 0, b: 255, a: 255 });
        assert.deepEqual(parseColor("black"), { r: 0, g: 0, b: 0, a: 255 });
        assert.deepEqual(parseColor("white"), { r: 255, g: 255, b: 255, a: 255 });
        assert.deepEqual(parseColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
    });

    void it("correctly parses 6-digit and 8-digit hex colors with and without prefix", () => {
        assert.deepEqual(parseColor("#ff0000"), { r: 255, g: 0, b: 0, a: 255 });
        assert.deepEqual(parseColor("ff0000"), { r: 255, g: 0, b: 0, a: 255 });
        assert.deepEqual(parseColor("#00ff00ff"), { r: 0, g: 255, b: 0, a: 255 });
        assert.deepEqual(parseColor("0000ff80"), { r: 0, g: 0, b: 255, a: 128 });
    });

    void it("correctly parses 3-digit and 4-digit short hex colors", () => {
        assert.deepEqual(parseColor("#f00"), { r: 255, g: 0, b: 0, a: 255 });
        assert.deepEqual(parseColor("0f0"), { r: 0, g: 255, b: 0, a: 255 });
        assert.deepEqual(parseColor("#00f8"), { r: 0, g: 0, b: 255, a: 136 });
    });

    void it("throws error for invalid colors", () => {
        assert.throws(() => parseColor("invalid_color_name"));
        assert.throws(() => parseColor("#12"));
        assert.throws(() => parseColor("#12345"));
    });
});

void describe("Solid PNG Generator", () => {
    void it("generates a buffer with PNG signature and chunk markers", () => {
        const buf = createSolidColorPng({ width: 10, height: 10, color: "blue" });

        // Verify PNG signature: 89 50 4E 47 0D 0A 1A 0A
        assert.equal(buf[0], 0x89);
        assert.equal(buf[1], 0x50);
        assert.equal(buf[2], 0x4e);
        assert.equal(buf[3], 0x47);
        assert.equal(buf[4], 0x0d);
        assert.equal(buf[5], 0x0a);
        assert.equal(buf[6], 0x1a);
        assert.equal(buf[7], 0x0a);

        // Verify it contains IHDR and IEND chunk names
        const str = buf.toString("ascii");
        assert.ok(str.includes("IHDR"));
        assert.ok(str.includes("IDAT"));
        assert.ok(str.includes("IEND"));
    });

    void it("generates a valid checkerboard pattern PNG", async () => {
        const { inflateSync } = await import("node:zlib");

        const width = 16;
        const height = 16;
        const checkerSize = 8;
        const buf = createSolidColorPng({
            width,
            height,
            color: "black",
            color2: "white",
            pattern: "checkerboard",
            checkerSize
        });

        // Simple helper to extract and inflate IDAT chunk data
        let offset = 8; // skip signature
        const idatBuffers: Buffer[] = [];

        while (offset < buf.length) {
            const length = buf.readUInt32BE(offset);
            const type = buf.toString("ascii", offset + 4, offset + 8);
            if (type === "IDAT") {
                idatBuffers.push(buf.subarray(offset + 8, offset + 8 + length));
            }
            offset += 12 + length;
        }

        const inflated = inflateSync(Buffer.concat(idatBuffers));

        const bytesPerPixel = 4;
        const scanlineLength = 1 + width * bytesPerPixel;

        // Verify top-left block (y=0, x=0) is color 1 (black)
        const row0 = 0;
        const pixel0_0 = row0 * scanlineLength + 1;
        assert.equal(inflated[pixel0_0], 0); // r
        assert.equal(inflated[pixel0_0 + 1], 0); // g
        assert.equal(inflated[pixel0_0 + 2], 0); // b
        assert.equal(inflated[pixel0_0 + 3], 255); // a

        // Verify top-right block (y=0, x=8) is color 2 (white)
        const pixel0_8 = row0 * scanlineLength + 1 + 8 * bytesPerPixel;
        assert.equal(inflated[pixel0_8], 255); // r
        assert.equal(inflated[pixel0_8 + 1], 255); // g
        assert.equal(inflated[pixel0_8 + 2], 255); // b
        assert.equal(inflated[pixel0_8 + 3], 255); // a

        // Verify bottom-left block (y=8, x=0) is color 2 (white)
        const row8 = 8;
        const pixel8_0 = row8 * scanlineLength + 1;
        assert.equal(inflated[pixel8_0], 255); // r
        assert.equal(inflated[pixel8_0 + 1], 255); // g
        assert.equal(inflated[pixel8_0 + 2], 255); // b
        assert.equal(inflated[pixel8_0 + 3], 255); // a

        // Verify bottom-right block (y=8, x=8) is color 1 (black)
        const pixel8_8 = row8 * scanlineLength + 1 + 8 * bytesPerPixel;
        assert.equal(inflated[pixel8_8], 0); // r
        assert.equal(inflated[pixel8_8 + 1], 0); // g
        assert.equal(inflated[pixel8_8 + 2], 0); // b
        assert.equal(inflated[pixel8_8 + 3], 255); // a
    });
});
