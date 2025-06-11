#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile>

import * as fs from 'fs/promises';
import * as pako from 'pako';
import * as path from 'path';
const term = require('terminal-kit').terminal;

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
        term.red('Usage: npx tsx scripts/rominspector.ts <romfile>\n');
        process.exit(1);
    }
    const raw = await fs.readFile(romfile);
    // If the ROM has a label, skip it (try to find the start of the zipped buffer)
    // For now, assume no label.
    let zipped = raw;
    // Decompress
    let decompressed: Uint8Array;
    try {
        decompressed = pako.inflate(zipped);
    } catch (e) {
        term.red('Failed to decompress ROM: ' + e.message + '\n');
        process.exit(1);
    }
    // Read 16-byte footer
    const footer = decompressed.slice(decompressed.length - 16);
    // Use BigInt for bitwise operations to avoid TS errors
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
    // Parse metadata
    let assets: any[];
    try {
        assets = decodeBinary(metaBuf);
    } catch (e) {
        term.red('Failed to decode metadata: ' + e.message + '\n');
        process.exit(1);
    }
    // Summary of assets
    const imageAssets = assets.filter(a => a.type === 'image');
    const audioCount = assets.filter(a => a.type === 'audio').length;
    const codeCount = assets.filter(a => a.type !== 'image' && a.type !== 'audio').length;
    function showSummary() {
        term.green(`Total assets: ${assets.length} (images: ${imageAssets.length}, audio: ${audioCount}, code: ${codeCount})\n`);
        if (imageAssets.length === 0) {
            term.yellow('No images found in ROM.\n');
            process.exit(0);
        }
    }
    // Prepare menu dimensions (subtract header lines: summary + blank + prompt = 3)
    const termWidth = term.width || 80;
    const termHeight = 6;//term.height || 24;
    const headerLines = 3;
    const menuHeight = Math.max(3, termHeight - headerLines);
    const maxNameLen = Math.max(...imageAssets.map(a => a.resname.length));
    const menuWidth = Math.min(termWidth - 4, maxNameLen + 6);
    // Image selection menu using gridLayout
    term('\nSelect image to preview (arrow keys, Enter to select):\n');
    const names = imageAssets.map(a => a.resname);
    // Calculate grid dimensions
    const cellWidth = Math.min(menuWidth, Math.max(...names.map(n => n.length)) + 4);
    const columns = Math.max(1, Math.floor(term.width / cellWidth));
    const rows = Math.ceil(names.length / columns);
    // Show the grid menu, allowing return after image view
    function showGridMenu() {
        term.gridMenu(names, {
            columns,
            rows,
            exitOnUnexpectedKey: true,
            cellWidth
        }, async (error: any, response: { selectedIndex: number }) => {
            if (error) process.exit(1);
            const selected = imageAssets[response.selectedIndex];
            // Extract and display image
            const imgBuf = decompressed.slice(selected.start, selected.end);
            const tmpPath = path.join(process.cwd(), '__rominspector_tmp.png');
            await fs.writeFile(tmpPath, imgBuf);
            term.clear();
            await new Promise(resolve => {
                term.drawImage(tmpPath, { shrink: { width: 64, height: 32 } }, () => {
                    fs.unlink(tmpPath);
                    resolve(undefined);
                });
            });
            term(
                '\nPress any key to return to menu...'
            );
            term.grabInput(true);
            term.once('key', () => {
                term.grabInput(false);
                term.clear();
                showSummary();
                showGridMenu();
            });
        });
    }
    // Initial show
    showSummary();
    showGridMenu();
}

main();
