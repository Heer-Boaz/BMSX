#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile>

import * as blessed from 'blessed';
import * as fs from 'fs/promises';
import * as pako from 'pako';
import { PNG } from 'pngjs';

// Minimal decodeBinary (copy from bootrom, no import)
function decodeBinary(buf: Uint8Array): any {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let offset = 0;
    const textDecoder = new TextDecoder();
    function readUint8(): number { return dv.getUint8(offset++); }
    function readVarUint(): number {
        let val = 0, shift = 0, b: number;
        do {
            b = buf[offset++];
            val |= (b & 0x7F) << shift;
            shift += 7;
        } while (b & 0x80);
        return val;
    }
    function readString(): string {
        const len = readVarUint();
        const arr = buf.subarray(offset, offset + len);
        offset += len;
        return textDecoder.decode(arr);
    }
    // --- Read property table ---
    const version = readUint8();
    if (version !== 0xA1) throw new Error('decodeBinary: unknown version');
    const propCount = readVarUint();
    const propNames: string[] = [];
    for (let i = 0; i < propCount; ++i) propNames.push(readString());
    function read(): any {
        const tag = readUint8();
        switch (tag) {
            case 0: return null;
            case 1: return true;
            case 2: return false;
            case 3: {
                const v = dv.getFloat64(offset, true);
                offset += 8;
                return v;
            }
            case 4: return readString();
            case 5: {
                const len = readVarUint();
                const arr = new Array(len);
                for (let i = 0; i < len; ++i) arr[i] = read();
                return arr;
            }
            case 6: {
                const ref = readVarUint();
                return { r: ref };
            }
            case 7: {
                const len = readVarUint();
                const obj: Record<string, any> = {};
                for (let i = 0; i < len; ++i) {
                    const propId = readVarUint();
                    const k = propNames[propId];
                    obj[k] = read();
                }
                return obj;
            }
            case 8: {
                const len = readVarUint();
                const arr = new Uint8Array(len);
                arr.set(buf.subarray(offset, offset + len));
                offset += len;
                return arr;
            }
            default:
                throw new Error(`Unknown tag in decodeBinary: ${tag}`);
        }
    }
    return read();
}

async function main() {
    const romfile = process.argv[2];
    if (!romfile) {
        console.error('Usage: npx tsx scripts/rominspector.ts <romfile>');
        process.exit(1);
    }
    const raw = await fs.readFile(romfile);
    let zipped = raw;
    let decompressed: Uint8Array;
    try {
        decompressed = pako.inflate(zipped);
    } catch (e: any) {
        console.error('Failed to decompress ROM: ' + e.message);
        process.exit(1);
    }
    const footer = decompressed.slice(decompressed.length - 16);
    function readLE64(buf: Uint8Array, offset: number): bigint {
        return (BigInt(buf[offset]) |
            (BigInt(buf[offset + 1]) << BigInt(8)) |
            (BigInt(buf[offset + 2]) << BigInt(16)) |
            (BigInt(buf[offset + 3]) << BigInt(24)) |
            (BigInt(buf[offset + 4]) << BigInt(32)) |
            (BigInt(buf[offset + 5]) << BigInt(40)) |
            (BigInt(buf[offset + 6]) << BigInt(48)) |
            (BigInt(buf[offset + 7]) << BigInt(56)));
    }
    const metadataOffset = Number(readLE64(footer, 0));
    const metadataLength = Number(readLE64(footer, 8));
    const metaBuf = decompressed.slice(metadataOffset, metadataOffset + metadataLength);
    let assets: any[];
    try {
        assets = decodeBinary(metaBuf);
    } catch (e: any) {
        console.error('Failed to decode metadata: ' + e.message);
        process.exit(1);
    }
    const imageAssets = assets.filter(a => a.type === 'image');
    const audioCount = assets.filter(a => a.type === 'audio').length;
    const codeCount = assets.filter(a => a.type !== 'image' && a.type !== 'audio').length;
    if (imageAssets.length === 0) {
        console.log('No images found in ROM.');
        process.exit(0);
    }
    // --- Blessed UI ---
    const screen = blessed.screen({
        smartCSR: true,
        title: 'ROM Inspector',
    });
    const summaryBox = blessed.box({
        top: 0,
        left: 'center',
        width: '100%',
        height: 3,
        content: `Total assets: ${assets.length} (images: ${imageAssets.length}, audio: ${audioCount}, code: ${codeCount})`,
        tags: true,
        style: { fg: 'green', bg: 'black' },
    });
    const list = blessed.list({
        top: 3,
        left: 'center',
        width: '100%',
        height: '100%-3',
        items: imageAssets.map(a => a.resname),
        keys: true,
        mouse: true,
        border: 'line',
        style: {
            selected: { bg: 'blue', fg: 'white' },
            item: { fg: 'white', bg: 'black' },
            border: { fg: 'cyan' },
        },
        label: 'Select image asset (Enter to view details, q to quit)',
        scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'blue' } },
    });
    screen.append(summaryBox);
    screen.append(list);
    list.focus();
    list.on('select', async (item, idx) => {
        const selected = imageAssets[idx];
        const meta = selected.imgmeta!;
        let width = meta.width || 0;
        let height = meta.height || 0;
        let atlasid: number | undefined = meta.atlasid;
        if (atlasid === undefined) atlasid = 0; // Default atlas ID if not specified
        let asciiArt = '';

        if (meta.atlassed && meta.texcoords) {
            // Atlas sub-image: extract region from the correct atlas asset by name suffix
            const atlasName = meta.atlasid === 0 ? '_atlas' : `_atlas${meta.atlasid}`;
            const atlasAsset = assets.find(a => a.resname === atlasName && a.type === 'image');
            if (atlasAsset) {
                const atlasBuf = atlasAsset.buffer instanceof Uint8Array
                    ? Buffer.from(atlasAsset.buffer)
                    : Buffer.from(decompressed.slice(atlasAsset.start, atlasAsset.end));
                try {
                    const atlasPng = PNG.sync.read(atlasBuf);
                    // texcoords: [x, y, w, h]
                    const [sx, sy, sw, sh] = meta.texcoords as number[];
                    width = sw;
                    height = sh;
                    const asciiChars = ' .:-=+*#%@';
                    const outW = Math.min(48, sw);
                    const outH = Math.floor(sh * (outW / sw));
                    for (let y = 0; y < outH; y++) {
                        let line = '';
                        for (let x = 0; x < outW; x++) {
                            const px = Math.floor(sx + x * sw / outW);
                            const py = Math.floor(sy + y * sh / outH);
                            const idx4 = (py * atlasPng.width + px) << 2;
                            const r = atlasPng.data[idx4], g = atlasPng.data[idx4 + 1], b = atlasPng.data[idx4 + 2], a = atlasPng.data[idx4 + 3];
                            const lum = a === 0 ? 255 : (r * 0.299 + g * 0.587 + b * 0.114);
                            const ch = asciiChars[Math.floor(lum / 256 * asciiChars.length)] || ' ';
                            line += ch;
                        }
                        asciiArt += line + '\n';
                    }
                } catch {
                    asciiArt = '[Failed to decode atlas PNG]';
                }
            } else {
                asciiArt = '[Atlas asset not found]';
            }
        } else {
            // Non-atlas image: decode its own PNG buffer
            const imgBuf = selected.buffer instanceof Uint8Array
                ? Buffer.from(selected.buffer)
                : Buffer.from(decompressed.slice(selected.start, selected.end));
            try {
                const png = PNG.sync.read(imgBuf);
                width = width || png.width;
                height = height || png.height;
                const asciiChars = ' .:-=+*#%@';
                const outW = Math.min(48, width);
                const outH = Math.floor(height * (outW / width));
                for (let y = 0; y < outH; y++) {
                    let line = '';
                    for (let x = 0; x < outW; x++) {
                        const px = Math.floor(x * width / outW);
                        const py = Math.floor(y * height / outH);
                        const idx4 = (py * width + px) << 2;
                        const r = png.data[idx4], g = png.data[idx4 + 1], b = png.data[idx4 + 2], a = png.data[idx4 + 3];
                        const lum = a === 0 ? 255 : (r * 0.299 + g * 0.587 + b * 0.114);
                        const ch = asciiChars[Math.floor(lum / 256 * asciiChars.length)] || ' ';
                        line += ch;
                    }
                    asciiArt += line + '\n';
                }
            } catch {
                asciiArt = '[Unable to generate ASCII preview]';
            }
        }

        // Show metadata details, including texcoords, boundingbox, etc.
        const metadataLines = [];
        metadataLines.push(`Type: ${selected.type}`);
        metadataLines.push(`Start: ${selected.start}`);
        metadataLines.push(`End: ${selected.end}`);
        metadataLines.push(`Size: ${selected.end - selected.start} bytes`);
        metadataLines.push(`Width: ${width}`);
        metadataLines.push(`Height: ${height}`)
        metadataLines.push(`Atlas ID: ${atlasid ?? 'None'}`);
        if (meta.texcoords) metadataLines.push(`Texcoords: [${meta.texcoords.join(', ')}]`);
        if (meta.boundingbox) metadataLines.push(`BoundingBox: ${JSON.stringify(meta.boundingbox)}`);
        if (meta.hitpolygons) metadataLines.push(`Hitpolygons: ${JSON.stringify(meta.hitpolygons)}`);
        metadataLines.push('');

        const modal = blessed.box({
            parent: screen,
            top: 'center', left: 'center',
            width: '80%', height: 'shrink',
            border: 'line', style: { border: { fg: 'yellow' }, bg: 'black' },
            label: `Image: ${selected.resname}`,
            content: metadataLines.join('\n') + '\n' + asciiArt + '\nPress any key to close...',
            tags: true, scrollable: true, alwaysScroll: true, keys: true, mouse: true,
            scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'yellow' } }
        });
        screen.render();
        screen.onceKey([], () => { modal.destroy(); screen.render(); });
    });
    screen.key(['q', 'C-c'], () => process.exit(0));
    screen.render();
}

main();
