import { deflateSync } from "node:zlib";

/**
 * RGBA color representation.
 */
export interface RgbaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

// Pre-computed CRC-32 table for fast checksumming.
const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[i] = c;
}

/**
 * Calculates the CRC-32 checksum of a Buffer.
 *
 * @param buffer The input buffer.
 * @returns The calculated CRC-32 checksum.
 */
export function calculateCrc32(buffer: Buffer): number {
    let crc = ~0;
    for (const element of buffer) {
        crc = CRC_TABLE[(crc ^ element) & 0xff] ^ (crc >>> 8);
    }
    return ~crc >>> 0;
}

/**
 * Parses a color string (name or hex) into an RGBA color structure.
 *
 * @param colorStr Color name or hex value.
 * @returns The parsed RgbaColor.
 */
export function parseColor(colorStr: string): RgbaColor {
    const trimmed = colorStr.trim().toLowerCase();

    const nameMap: Record<string, RgbaColor> = {
        red: { r: 255, g: 0, b: 0, a: 255 },
        green: { r: 0, g: 255, b: 0, a: 255 },
        blue: { r: 0, g: 0, b: 255, a: 255 },
        black: { r: 0, g: 0, b: 0, a: 255 },
        white: { r: 255, g: 255, b: 255, a: 255 },
        transparent: { r: 0, g: 0, b: 0, a: 0 },
        yellow: { r: 255, g: 255, b: 0, a: 255 },
        magenta: { r: 255, g: 0, b: 255, a: 255 },
        fuchsia: { r: 255, g: 0, b: 255, a: 255 },
        cyan: { r: 0, g: 255, b: 255, a: 255 },
        aqua: { r: 0, g: 255, b: 255, a: 255 },
        gray: { r: 128, g: 128, b: 128, a: 255 },
        grey: { r: 128, g: 128, b: 128, a: 255 },
        orange: { r: 255, g: 165, b: 0, a: 255 },
        purple: { r: 128, g: 0, b: 128, a: 255 },
        pink: { r: 255, g: 192, b: 203, a: 255 }
    };

    if (nameMap[trimmed] !== undefined) {
        return nameMap[trimmed];
    }

    const hexPattern = /^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
    const match = trimmed.match(hexPattern);
    if (!match) {
        throw new Error(
            `Invalid color specification: "${colorStr}". Supported formats are color names (e.g. "red") or hex values (e.g. "#FF0000").`
        );
    }

    const hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
        const r = Number.parseInt(hex[0] + hex[0], 16);
        const g = Number.parseInt(hex[1] + hex[1], 16);
        const b = Number.parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? Number.parseInt(hex[3] + hex[3], 16) : 255;
        return { r, g, b, a };
    } else {
        const r = Number.parseInt(hex.slice(0, 2), 16);
        const g = Number.parseInt(hex.slice(2, 4), 16);
        const b = Number.parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255;
        return { r, g, b, a };
    }
}

function createChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);

    const crcBuf = Buffer.concat([typeBuf, data]);
    const crcValue = calculateCrc32(crcBuf);

    const crcOutBuf = Buffer.alloc(4);
    crcOutBuf.writeUInt32BE(crcValue, 0);

    return Buffer.concat([lenBuf, typeBuf, data, crcOutBuf]);
}

/**
 * Configuration options for generating a PNG image.
 */
export interface CreateSolidColorPngRequest {
    color: string;
    height: number;
    width: number;
    color2?: string;
    pattern?: "solid" | "checkerboard";
    checkerSize?: number;
}

/**
 * Generates a PNG image of a given color/pattern and dimensions.
 *
 * @param request Specification for the image width, height, color, and optional pattern.
 * @returns Buffer containing the complete valid PNG binary data.
 */
export function createSolidColorPng(request: CreateSolidColorPngRequest): Buffer {
    const { width, height, color, color2 = "white", pattern = "solid", checkerSize = 8 } = request;
    const parsedColor1 = parseColor(color);
    const parsedColor2 = parseColor(color2);

    const bytesPerPixel = 4; // RGBA
    const scanlineLength = 1 + width * bytesPerPixel;
    const unfiltered = Buffer.alloc(scanlineLength * height);

    for (let y = 0; y < height; y++) {
        const rowOffset = y * scanlineLength;
        unfiltered[rowOffset] = 0; // Filter type 0 (None)
        const gridY = Math.floor(y / checkerSize);

        for (let x = 0; x < width; x++) {
            const pixelOffset = rowOffset + 1 + x * bytesPerPixel;

            let currentPixelColor = parsedColor1;
            if (pattern === "checkerboard") {
                const gridX = Math.floor(x / checkerSize);
                if ((gridX + gridY) % 2 !== 0) {
                    currentPixelColor = parsedColor2;
                }
            }

            unfiltered[pixelOffset] = currentPixelColor.r;
            unfiltered[pixelOffset + 1] = currentPixelColor.g;
            unfiltered[pixelOffset + 2] = currentPixelColor.b;
            unfiltered[pixelOffset + 3] = currentPixelColor.a;
        }
    }

    const compressed = deflateSync(unfiltered);
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 6; // color type (RGBA)
    ihdrData[10] = 0; // compression method
    ihdrData[11] = 0; // filter method
    ihdrData[12] = 0; // interlace method

    const ihdrChunk = createChunk("IHDR", ihdrData);
    const idatChunk = createChunk("IDAT", compressed);
    const iendChunk = createChunk("IEND", Buffer.alloc(0));

    return Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);
}
