#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile>

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
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
    let raw: Buffer
    try {
        raw = await fs.readFile(romfile);
    }
    catch {
    }
    // Check whether the file exists
    if (!raw) {
        console.error(`Failed to read ROM file at "${romfile}"`);
        process.exit(1);
    }
    function isPakoCompressed(raw: Uint8Array): boolean {
        // Gzip: 1F 8B
        if (raw[0] === 0x1F && raw[1] === 0x8B) return true;
        // Zlib: 78 01 / 78 9C / 78 DA
        if (raw[0] === 0x78 && (raw[1] === 0x01 || raw[1] === 0x9C || raw[1] === 0xDA)) return true;
        return false;
    }

    const isCompressed = isPakoCompressed(raw);
    let rompack = null;
    if (isCompressed) {
        console.log('ROM is compressed, decompressing...');
        let zipped = raw;
        let decompressed: Uint8Array;
        try {
            decompressed = pako.inflate(zipped);
        } catch (e: any) {
            console.error('Failed to decompress ROM: ' + e.message);
            process.exit(1);
        }
        rompack = decompressed;
    } else {
        console.log('ROM is uncompressed, using as-is.');
        rompack = raw;
    }
    if (!rompack) {
        console.error('Failed to read or decompress ROM file, invalid ROM file.');
        process.exit(1);
    }

    if (!rompack.length || rompack.length < 16) {
        console.error('ROM file is empty or too short, invalid ROM file.');
        process.exit(1);
    }
    const footer = rompack.slice(rompack.length - 16);
    if (footer.length < 16) {
        console.error('ROM footer is too short, invalid ROM file.');
        process.exit(1);
    }
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
    const metaBuf = rompack.slice(metadataOffset, metadataOffset + metadataLength);
    if (!metaBuf || metaBuf.length === 0) {
        console.error('No metadata found in ROM file, invalid ROM file.');
        process.exit(1);
    }
    if (metadataOffset < 0 || metadataOffset + metadataLength > rompack.length) {
        console.error(`Invalid metadata offset or length: offset=${metadataOffset}, length=${metadataLength}`);
        process.exit(1);
    }
    if (metaBuf.length !== metadataLength) {
        console.error(`Metadata length mismatch: expected ${metadataLength} bytes, got ${metaBuf.length} bytes`);
        process.exit(1);
    }
    let assetList: any[];
    try {
        assetList = decodeBinary(metaBuf);
        if (!assetList || !Array.isArray(assetList)) {
            console.error('Invalid metadata format: expected an array of assets');
            process.exit(1);
        }
    } catch (e: any) {
        console.error(`Failed to decode metadata: ${e.message}`);
        process.exit(1);
    }
    // Parse per-asset metabuffer and assign to asset
    for (const asset of assetList) {
        if (asset.metabuffer_start != null && asset.metabuffer_end != null) {
            const metaSlice = rompack.slice(asset.metabuffer_start, asset.metabuffer_end);
            const decodedMeta = decodeBinary(new Uint8Array(metaSlice));
            switch (asset.type) {
                case 'image':
                    asset.imgmeta = decodedMeta;
                    break;
                case 'audio':
                    asset.audiometa = decodedMeta;
                    break;
                default:
                    // unsupported metadata type
                    break;
            }
        }
    }
    const imageAssets = assetList.filter(a => a.type === 'image') ?? [];
    const audioCount = assetList.filter(a => a.type === 'audio')?.length ?? 0;
    const codeCount = assetList.filter(a => a.type !== 'image' && a.type !== 'audio')?.length ?? 0;

    // --- Blessed UI ---
    const screen = blessed.screen({
        smartCSR: true,
        title: 'ROM Inspector',
        mouse: true,
        warnings: true,
    });

    // Dynamically determine bar length based on window width
    function getBarLength() {
        // Use screen.width minus some padding for brackets and label
        const minBar = 16, maxBar = 120;
        let w = (typeof screen.width === 'number' ? screen.width : 80) - 16;
        if (w < minBar) w = minBar;
        if (w > maxBar) w = maxBar;
        return Math.floor(w);
    }

    let barLength = getBarLength();
    // Generate summary buffer bar for metadata region
    const totalSize = rompack.length;
    const metaStartPos = Math.floor((metadataOffset / totalSize) * barLength);
    const metaEndPos = Math.ceil(((metadataOffset + metadataLength) / totalSize) * barLength);
    // Compute asset regions for summary bar with type coloring (now includes metabuffer)
    let summaryBar = '';
    for (let i = 0; i < barLength; i++) {
        const cellStart = Math.floor((i / barLength) * totalSize);
        const cellEnd = Math.floor(((i + 1) / barLength) * totalSize);
        let color = '';
        // Priority: code > audio > image > metadata
        let found = false;
        for (const asset of assetList) {
            // Main buffer region
            if (typeof asset.start === 'number' && typeof asset.end === 'number') {
                if (cellEnd > asset.start && cellStart < asset.end) {
                    if (asset.type !== 'image' && asset.type !== 'audio') { color = '{white-fg}█{/white-fg}'; found = true; break; }
                    if (asset.type === 'audio') { color = '{magenta-fg}█{/magenta-fg}'; found = true; }
                    if (asset.type === 'image' && !found) { color = '{yellow-fg}█{/yellow-fg}'; }
                }
            }
            // Metabuffer region (draw as cyan if not already colored)
            if (!color && typeof asset.metabuffer_start === 'number' && typeof asset.metabuffer_end === 'number') {
                if (cellEnd > asset.metabuffer_start && cellStart < asset.metabuffer_end) {
                    color = '{cyan-fg}█{/cyan-fg}';
                }
            }
        }
        if (!color && i >= metaStartPos && i < metaEndPos) color = '{blue-fg}█{/blue-fg}';
        if (!color) color = ' ';
        summaryBar += color;
    }

    // Compute total bytes used by atlassed images (approximate via atlas occupancy)
    let atlassedBytesTotal = 0;
    for (const asset of assetList) {
        const meta = asset.imgmeta || {};
        if (asset.type === 'image' && meta.atlassed && meta.texcoords) {
            const [sx, sy, sw, sh] = meta.texcoords as number[];
            const atlasName = meta.atlasid === 0 ? '_atlas' : `_atlas${meta.atlasid}`;
            const atlasAsset = assetList.find(a => a.resname === atlasName && a.type === 'image');
            if (atlasAsset) {
                const atlasSize = atlasAsset.end - atlasAsset.start;
                const atlasMeta = atlasAsset.imgmeta || {};
                const aw = atlasMeta.width || 1;
                const ah = atlasMeta.height || 1;
                // Coordinates are normalized (0-1), compute area ratio directly
                const areaRatio = sw * sh;
                atlassedBytesTotal += areaRatio * atlasSize;
            }
        }
    }
    const atlassedKB = (atlassedBytesTotal / 1024).toFixed(2);

    const summaryBox = blessed.box({
        top: 0,
        left: 'center',
        width: '100%',
        height: 8,
        tags: true,
        style: { fg: 'green', bg: 'black' },
        content:
            `Total assets: ${assetList?.length ?? 0} (images: ${imageAssets?.length ?? 0}, audio: ${audioCount}, code: ${codeCount})\n` +
            `Buffer: [${summaryBar}]\n` +
            `{yellow-fg}█{/yellow-fg} image  {magenta-fg}█{/magenta-fg} audio  {white-fg}█{/white-fg} code  {cyan-fg}█{/cyan-fg} metabuffer  {blue-fg}█{/blue-fg} global metadata\n` +
            `Legend: {yellow-fg}image{/}, {magenta-fg}audio{/}, {white-fg}code{/}, {cyan-fg}per-asset metabuffer{/}, {blue-fg}global metadata{/}\n` +
            `metadata: offset ${metadataOffset}, length ${metadataLength} bytes\n` +
            `Atlassed images: ${Math.round(atlassedBytesTotal)} bytes (${atlassedKB} KB)`
    });
    const table = contrib.table({
        top: 3,
        left: 'center',
        width: '100%',
        height: '100%-3',
        border: { type: 'line', fg: 'cyan' },
        columnSpacing: 2,
        columnWidth: [30, 10], // Adjust as needed
        keys: true,
        interactive: 'true',
        label: 'Select asset (Enter to view details, q to quit)',
        style: {
            header: { fg: 'white', bg: 'blue' },
            cell: { fg: 'white', bg: 'black' },
            border: { fg: 'cyan' },
            focus: { border: { fg: 'yellow' } }
        },
        mouse: true,
    });

    const tableRows = assetList.map(asset => [
        asset.resname ? String(asset.resname) : '',
        asset.type ? String(asset.type) : ''
    ]);
    table.setData({
        headers: ['Name', 'Type'],
        data: tableRows
    });

    screen.append(summaryBox);
    screen.append(table);
    table.focus();
    screen.render();

    // Add custom key handlers for pageup/pagedown/home/end
    const tableRowsList = (table as any).rows;
    tableRowsList.key(['pageup'], function () {
        const page = this.height - 1;
        this.select(Math.max(0, this.selected - page));
        this.screen.render();
    });
    tableRowsList.key(['pagedown'], function () {
        const page = this.height - 1;
        this.select(Math.min(this.items.length - 1, this.selected + page));
        this.screen.render();
    });
    tableRowsList.key(['home'], function () {
        this.select(0);
        this.screen.render();
    });
    tableRowsList.key(['end'], function () {
        this.select(this.items.length - 1);
        this.screen.render();
    });

    // Use table.rows for selection events (works for both mouse and keyboard)
    (table as any).rows.on('select', (item, idx) => {
        const selected = assetList[idx];
        const meta = selected.imgmeta || {};
        let width = meta.width || 0;
        let height = meta.height || 0;
        let atlasid = meta.atlasid;
        if (atlasid === undefined) atlasid = 0;
        let asciiArt = '';
        if (selected.type === 'image') {
            if (meta.atlassed && meta.texcoords) {
                const atlasName = meta.atlasid === 0 ? '_atlas' : `_atlas${meta.atlasid}`;
                const atlasAsset = assetList.find(a => a.resname === atlasName && a.type === 'image');
                if (atlasAsset) {
                    const atlasBuf = atlasAsset.buffer instanceof Uint8Array
                        ? Buffer.from(atlasAsset.buffer)
                        : Buffer.from(rompack.slice(atlasAsset.start, atlasAsset.end));
                    try {
                        const atlasPng = PNG.sync.read(atlasBuf);
                        const [sx, sy, sw, sh] = meta.texcoords as number[];
                        // Convert normalized texcoords to pixel dimensions
                        width = Math.floor(sw * atlasPng.width);
                        height = Math.floor(sh * atlasPng.height);
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
                                const ch = asciiChars[Math.floor(lum / 256 * (asciiChars?.length ?? 0))] || ' ';
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
                const imgBuf = selected.buffer instanceof Uint8Array
                    ? Buffer.from(selected.buffer)
                    : Buffer.from(rompack.slice(selected.start, selected.end));
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
                            const ch = asciiChars[Math.floor(lum / 256 * (asciiChars?.length ?? 0))] || ' ';
                            line += ch;
                        }
                        asciiArt += line + '\n';
                    }
                } catch {
                    asciiArt = '[Unable to generate ASCII preview]';
                }
            }
        }
        // Show metadata details, including texcoords, boundingbox, etc.
        const metadataLines = [];
        metadataLines.push(`Type: ${selected.type}`);
        metadataLines.push(`Name: ${selected.resname}`);
        if (selected.start !== undefined) metadataLines.push(`Start: ${selected.start} ( ${(selected.start / 1024).toFixed(2)} KB )`);
        if (selected.end !== undefined) metadataLines.push(`End: ${selected.end} ( ${(selected.end / 1024).toFixed(2)} KB )`);
        if (selected.start !== undefined && selected.end !== undefined) {
            const sizeBytes = selected.end - selected.start;
            metadataLines.push(`Size: ${sizeBytes} bytes ( ${(sizeBytes / 1024).toFixed(2)} KB )`);
        }
        // Metabuffer region info
        if (selected.metabuffer_start !== undefined && selected.metabuffer_end !== undefined) {
            const metaSize = selected.metabuffer_end - selected.metabuffer_start;
            metadataLines.push(`Metabuffer: ${selected.metabuffer_start} - ${selected.metabuffer_end} (${metaSize} bytes, ${(metaSize / 1024).toFixed(2)} KB)`);
        }
        // Enhanced ASCII bar showing asset and metabuffer regions within total ROM
        if (selected.start !== undefined && selected.end !== undefined) {
            const barLength = getBarLength();
            const total = rompack.length;
            const startPos = Math.floor((selected.start / total) * barLength);
            const endPos = Math.ceil((selected.end / total) * barLength);
            let metaStartPos = -1, metaEndPos = -1;
            if (selected.metabuffer_start !== undefined && selected.metabuffer_end !== undefined) {
                metaStartPos = Math.floor((selected.metabuffer_start / total) * barLength);
                metaEndPos = Math.ceil((selected.metabuffer_end / total) * barLength);
            }
            let bar = '';
            for (let i = 0; i < barLength; i++) {
                if (i === startPos) {
                    bar += '{green-fg}|{/}';
                } else if (i === endPos - 1) {
                    bar += '{red-fg}|{/}';
                } else if (i >= startPos && i < endPos) {
                    bar += '{yellow-fg}█{/yellow-fg}';
                } else if (metaStartPos !== -1 && i >= metaStartPos && i < metaEndPos) {
                    bar += '{cyan-fg}█{/cyan-fg}';
                } else {
                    bar += ' ';
                }
            }
            metadataLines.push(`Buffer: [${bar}]`);
            metadataLines.push(`        {green-fg}|{/} start (${selected.start}), {red-fg}|{/} end (${selected.end})` + (metaStartPos !== -1 ? `, {cyan-fg}█{/cyan-fg} metabuffer` : ''));
        }
        if (width) metadataLines.push(`Width: ${width}`);
        if (height) metadataLines.push(`Height: ${height}`);
        // Only show Atlas ID for images
        if (atlasid !== undefined && selected.type === 'image') metadataLines.push(`Atlas ID: ${atlasid}`);
        if (meta.texcoords) metadataLines.push(`Texcoords: [${meta.texcoords.join(', ')}]`);
        if (meta.boundingbox) metadataLines.push(`BoundingBox: ${JSON.stringify(meta.boundingbox)}`);
        if (meta.hitpolygons) metadataLines.push(`Hitpolygons: ${JSON.stringify(meta.hitpolygons)}`);
        metadataLines.push('');
        const modal = blessed.box({
            parent: screen,
            top: 'center', left: 'center',
            width: '80%', height: 'shrink',
            border: 'line', style: { border: { fg: 'yellow' }, bg: 'black' },
            label: `Asset: ${selected.resname}`,
            content: metadataLines.join('\n') + (asciiArt ? ('\n' + asciiArt) : '') + '\nPress any key to close...',
            tags: true, scrollable: true, alwaysScroll: true, keys: true, mouse: true,
            scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'yellow' } }
        });
        modal.focus();
        let ignoreFirstKeypress = true;
        modal.on('keypress', (ch, key) => {
            if (key.name === 'up' || key.name === 'down' || key.name === 'left' || key.name === 'right') {
                return;
            }
            if (ignoreFirstKeypress) {
                ignoreFirstKeypress = false;
                return;
            }
            modal.destroy();
            screen.render();
        });
        screen.render();
    });
    screen.key(['q', 'C-c'], () => process.exit(0));
    screen.render();

    // Redraw summary bar on resize
    screen.on('resize', () => {
        barLength = getBarLength();
        const metaStartPos = Math.floor((metadataOffset / totalSize) * barLength);
        const metaEndPos = Math.ceil(((metadataOffset + metadataLength) / totalSize) * barLength);
        let summaryBar = '';
        for (let i = 0; i < barLength; i++) {
            const cellStart = Math.floor((i / barLength) * totalSize);
            const cellEnd = Math.floor(((i + 1) / barLength) * totalSize);
            let color = '';
            let found = false;
            for (const asset of assetList) {
                if (typeof asset.start === 'number' && typeof asset.end === 'number') {
                    if (cellEnd > asset.start && cellStart < asset.end) {
                        if (asset.type !== 'image' && asset.type !== 'audio') { color = '{white-fg}█{/white-fg}'; found = true; break; }
                        if (asset.type === 'audio') { color = '{magenta-fg}█{/magenta-fg}'; found = true; }
                        if (asset.type === 'image' && !found) { color = '{yellow-fg}█{/yellow-fg}'; }
                    }
                }
            }
            if (!color && i >= metaStartPos && i < metaEndPos) color = '{blue-fg}█{/blue-fg}';
            if (!color) color = ' ';
            summaryBar += color;
        }
        summaryBox.setContent(
            `Total assets: ${assetList?.length ?? 0} (images: ${imageAssets?.length ?? 0}, audio: ${audioCount}, code: ${codeCount})\n` +
            `Buffer: [${summaryBar}]\n` +
            `{yellow-fg}█{/yellow-fg} image  {magenta-fg}█{/magenta-fg} audio  {white-fg}█{/white-fg} code  {cyan-fg}█{/cyan-fg} metabuffer  {blue-fg}█{/blue-fg} global metadata\n` +
            `Legend: {yellow-fg}image{/}, {magenta-fg}audio{/}, {white-fg}code{/}, {cyan-fg}per-asset metabuffer{/}, {blue-fg}global metadata{/}\n` +
            `metadata: offset ${metadataOffset}, length ${metadataLength} bytes\n` +
            `Atlassed images: ${Math.round(atlassedBytesTotal)} bytes (${atlassedKB} KB)`
        );
        screen.render();
    });
}

main();
