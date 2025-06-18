#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile>

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import * as fs from 'fs/promises';
import * as pako from 'pako';
import { PNG } from 'pngjs';
import type { AudioMeta, ImgMeta, RomAsset } from '../src/bmsx/rompack';

function byteSizeToString(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
    let error: any;
    try {
        raw = await fs.readFile(romfile);
    }
    catch (e: any) {
        error = e;
    }
    // Check whether the file exists
    if (!raw) {
        console.error(`Failed to read ROM file at "${romfile}": ${error?.message || 'Unknown error'}`);
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
        warnings: false,
    });

    /**
     * Renders a simple summary bar with only full blocks.
     * No partial blocks are used; each region cell is either fully filled or empty.
     * Overlapping regions are handled by priority (first region in the array is shown).
     */
    function renderSummaryBar(
        regions: Array<{ start: number, end: number, colorTag: string }>,
        totalSize: number,
        barLength: number
    ): string {
        let bar = '';

        // Initialize all cells as blank.
        const cellColors = new Array(barLength).fill('');
        const cellChars = new Array(barLength).fill(' ');

        // Process regions in priority order:
        for (const region of regions) {
            const regionStartCell = Math.floor((region.start / totalSize) * barLength);
            const regionEndCell = Math.ceil((region.end / totalSize) * barLength) - 1;

            // Clamp to valid cell indices.
            const startCell = Math.max(0, regionStartCell);
            const endCell = Math.min(barLength - 1, regionEndCell);

            // Fill each cell within the region with a full block, unless it's already set by a higher-priority region.
            for (let i = startCell; i <= endCell; i++) {
                // If not already covered, fill with this region.
                if (cellChars[i] === ' ') {
                    cellChars[i] = '█';
                    cellColors[i] = region.colorTag;
                }
            }
        }

        for (let i = 0; i < barLength; i++) {
            bar += cellColors[i] + cellChars[i] + '{/}';
        }

        return bar;
    }

    /**
     * Renders a buffer bar where we only do detailed (fractional) rendering
     * at the very first and last cell of each region, and full blocks (█)
     * in between. Overlapping regions are handled by priority (first in array wins).
     */
    function renderBufferBar(
        regions: Array<{ start: number; end: number; colorTag: string }>,
        totalSize: number,
        barLength: number
    ): string {
        const blocks = ['▏', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
        const cellSize = totalSize / barLength;
        const defaultCellChar = '░';
        const cellChars = new Array(barLength).fill(defaultCellChar);
        const cellColors = new Array(barLength).fill('');

        for (const region of regions) {
            const startFloat = region.start / cellSize;
            const endFloat = region.end / cellSize;
            const regionStartCell = Math.floor(startFloat);
            const regionEndCell = Math.floor(endFloat);
            const leftFrac = startFloat - regionStartCell;
            const rightFrac = endFloat - regionEndCell;
            const startCell = Math.max(0, Math.min(barLength - 1, regionStartCell));
            const endCell = Math.max(0, Math.min(barLength - 1, regionEndCell));

            // fill full interior
            for (let i = startCell + 1; i < endCell; i++) {
                if (cellChars[i] === defaultCellChar) {
                    cellChars[i] = '█';
                    cellColors[i] = region.colorTag;
                }
            }
            // left boundary
            if (cellChars[startCell] === defaultCellChar) {
                if (startCell === endCell) {
                    // Region fits entirely within one cell
                    const regionStart = region.start;
                    const regionEnd = region.end;
                    const cellStart = startCell * cellSize;
                    const cellEnd = (startCell + 1) * cellSize;
                    const overlapStart = Math.max(cellStart, regionStart);
                    const overlapEnd = Math.min(cellEnd, regionEnd);
                    const overlap = Math.max(0, overlapEnd - overlapStart);
                    const coverage = overlap / cellSize;
                    const idx = Math.round(coverage * 8);
                    if (idx >= 8) {
                        cellChars[startCell] = '█';
                        cellColors[startCell] = region.colorTag;
                    } else if (idx > 0) {
                        cellChars[startCell] = blocks[idx];
                        // Find the highest-priority overlapping region's colorTag for fg
                        let fgColor = '{black-fg}';
                        for (const r of regions) {
                            // Only check other regions, not the current one
                            if (r === region) continue;
                            // Check if this region overlaps with the current cell
                            if (r.start < cellEnd && r.end > cellStart) {
                                fgColor = r.colorTag;
                                break;
                            }
                        }
                        cellColors[startCell] = region.colorTag.replace('-fg}', '-bg}') + fgColor;
                    }
                } else {
                    const coverage = 1 - leftFrac;
                    const idx = Math.round(coverage * 8);
                    if (idx >= 8) {
                        cellChars[startCell] = '█';
                        cellColors[startCell] = region.colorTag;
                    } else if (idx > 0) {
                        // fractional: invert color background
                        cellChars[startCell] = blocks[idx];
                        // Find the highest-priority overlapping region's colorTag for fg
                        let fgColor = '{black-fg}';
                        for (const r of regions) {
                            // Only check other regions, not the current one
                            if (r === region) continue;
                            // Check if this region overlaps with the current cell
                            if (r.start < (startCell + 1) * cellSize && r.end > startCell * cellSize) {
                                fgColor = r.colorTag;
                                break;
                            }
                        }
                        cellColors[startCell] = region.colorTag.replace('-fg}', '-bg}') + fgColor;
                    }
                }
            }
            // right boundary
            if (endCell !== startCell && cellChars[endCell] === ' ') {
                const coverage = rightFrac;
                const idx = Math.round(coverage * 8);
                if (idx >= 8) {
                    cellChars[endCell] = '█';
                    cellColors[endCell] = region.colorTag;
                } else if (idx > 0) {
                    cellChars[endCell] = blocks[idx];
                    cellColors[endCell] = region.colorTag;
                }
            }
        }

        let bar = '';
        for (let i = 0; i < barLength; i++) {
            bar += cellColors[i] + cellChars[i] + '{/}';
        }
        return bar;
    }

    // Dynamically determine bar length based on window width
    function getBarLength(containerWidth: number) {
        // Use screen.width minus some padding for brackets and label
        const minBar = 16, maxBar = containerWidth;
        let w = maxBar - 16;
        if (w < minBar) w = minBar;
        if (w > maxBar) w = maxBar;
        return Math.floor(w);
    }

    function generateSummaryContent() {
        const imagesSize = imageAssets.reduce((sum, a) => {
            let size = 0;
            if (a.start != null && a.end != null) size += a.end - a.start;
            if (a.metabuffer_start != null && a.metabuffer_end != null) size += a.metabuffer_end - a.metabuffer_start;
            return sum + size;
        }, 0);
        const audioSize = assetList.filter(a => a.type === 'audio').reduce((sum, a) => {
            let size = 0;
            if (a.start != null && a.end != null) size += a.end - a.start;
            if (a.metabuffer_start != null && a.metabuffer_end != null) size += a.metabuffer_end - a.metabuffer_start;
            return sum + size;
        }, 0);
        const codeSize = assetList.reduce((sum, a) => a.type === 'source' ? sum + (a.end - a.start) : sum, 0);
        const totalSize = rompack.length;
        const summaryRegions = [
            ...imageAssets.map(a => ({ start: a.start, end: a.end, colorTag: '{yellow-fg}', label: 'image' })),
            ...assetList.filter(a => a.type === 'audio').map(a => ({ start: a.start, end: a.end, colorTag: '{magenta-fg}', label: 'audio' })),
            ...assetList.filter(a => a.type !== 'image' && a.type !== 'audio' && a.start != null && a.end != null).map(a => ({ start: a.start, end: a.end, colorTag: '{white-fg}', label: 'code' })),
            ...assetList.filter(a => a.metabuffer_start != null && a.metabuffer_end != null).map(a => ({ start: a.metabuffer_start, end: a.metabuffer_end, colorTag: '{cyan-fg}', label: 'metabuffer' })),
            { start: metadataOffset, end: metadataOffset + metadataLength, colorTag: '{blue-fg}', label: 'global metadata' }
        ];
        const imageSizePercent = (imagesSize / totalSize * 100).toFixed(1);
        const audioSizePercent = (audioSize / totalSize * 100).toFixed(1);
        const codeSizePercent = (codeSize / totalSize * 100).toFixed(1);
        const metaSizePercent = (metaBuf.length / totalSize * 100).toFixed(1);

        return `Total assets: ${assetList?.length ?? 0} (images: ${imageAssets?.length ?? 0
            }, audio: ${audioCount}, code: ${codeCount}) \n` +
            `Buffer: [${renderSummaryBar(summaryRegions, totalSize, barLength)}]\n` +
            `{yellow-fg}█{/yellow-fg} image  {magenta-fg}█{/magenta-fg} audio  {white-fg}█{/white-fg} code  {cyan-fg}█{/cyan-fg} metabuffer  {blue-fg}█{/blue-fg} global metadata\n` +
            `Images size: ${byteSizeToString(imagesSize)} (${imageSizePercent}%)\n` +
            `Audio size: ${byteSizeToString(audioSize)} (${audioSizePercent}%)\n` +
            `Code size: ${byteSizeToString(codeSize)} (${codeSizePercent}%)\n` +
            `Metadata size: ${byteSizeToString(metaBuf.length)} (${metaSizePercent}%)\n` +
            `Total size: ${byteSizeToString(totalSize)}\n`;
    }

    let barLength = getBarLength(typeof screen.width === 'number' ? screen.width : 120);

    // --- Compute regions for summary bar ---
    const summaryRegions: Array<{ start: number, end: number, colorTag: string, label?: string }> = [];
    for (const asset of assetList) {
        if (asset.type !== 'image' && asset.type !== 'audio' && asset.start != null && asset.end != null) {
            summaryRegions.push({ start: asset.start, end: asset.end, colorTag: '{white-fg}', label: 'code' });
        }
    }
    for (const asset of assetList) {
        if (asset.type === 'audio' && asset.start != null && asset.end != null) {
            summaryRegions.push({ start: asset.start, end: asset.end, colorTag: '{magenta-fg}', label: 'audio' });
        }
    }
    for (const asset of assetList) {
        if (asset.type === 'image' && asset.start != null && asset.end != null) {
            summaryRegions.push({ start: asset.start, end: asset.end, colorTag: '{yellow-fg}', label: 'image' });
        }
    }
    for (const asset of assetList) {
        if (asset.metabuffer_start != null && asset.metabuffer_end != null) {
            summaryRegions.push({ start: asset.metabuffer_start, end: asset.metabuffer_end, colorTag: '{cyan-fg}', label: 'metabuffer' });
        }
    }
    // Global metadata region
    summaryRegions.push({ start: metadataOffset, end: metadataOffset + metadataLength, colorTag: '{blue-fg}', label: 'global metadata' });

    // Calculate atlassed image sizes
    let atlassedBytesTotal = 0;
    for (const asset of assetList) {
        if (asset.type === 'image' && asset.imgmeta.atlassed && asset.start != null && asset.end != null) {
            atlassedBytesTotal += asset.end - asset.start;
        }
    }
    const atlassedKB = (atlassedBytesTotal / 1024).toFixed(1);

    const summaryBox = blessed.box({
        top: 0,
        left: 'center',
        width: '100%',
        height: 8,
        tags: true,
        style: { fg: 'green', bg: 'black' },
        content: generateSummaryContent()
    });
    const table = contrib.table({
        top: 8,
        left: 'center',
        width: '100%',
        height: '100%-8',
        border: { type: 'line', fg: 'cyan' },
        columnSpacing: 2,
        columnWidth: [30, 5, 10, 10],
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

    updateTable();

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
        const selected = assetList[idx] as RomAsset;
        const imgmeta = selected.imgmeta || {} as ImgMeta;
        const audiometa = selected.audiometa || {} as AudioMeta;
        const bufferSize = selected.end - selected.start;
        let asciiArt = '';
        const metadataLines = [];

        // Show generic metadata details
        metadataLines.push(`Name: ${selected.resname} # ID: ${selected.resid} # Type: ${selected.type}`);
        if (bufferSize !== undefined) metadataLines.push(`Buffer: ${selected.start} - ${selected.end} (${byteSizeToString(bufferSize)})`);
        // Metabuffer region info
        const metabufferSize = selected.metabuffer_end - selected.metabuffer_start;
        if (metabufferSize !== undefined) metadataLines.push(`Metabuffer: ${selected.metabuffer_start} - ${selected.metabuffer_end} (${byteSizeToString(metabufferSize)})`);
        if (bufferSize !== undefined && metabufferSize !== undefined) {
            const totalSize = bufferSize + metabufferSize;
            metadataLines.push(`Total size: ${byteSizeToString(totalSize)}`);
        }

        metadataLines.push('---------------------------------');

        // Enhanced ASCII bar showing asset and metabuffer regions within total ROM
        if (bufferSize !== undefined) {
            const termWidth = typeof screen.width === 'number' ? screen.width : 120;
            const barLength = getBarLength(termWidth * 0.8);
            const total = rompack.length;
            // Compose regions for this asset: asset, metabuffer, global metadata
            const regions = [];
            regions.push({ start: selected.start, end: selected.end, colorTag: '{yellow-fg}' });
            if (selected.metabuffer_start !== undefined && selected.metabuffer_end !== undefined) {
                regions.push({ start: selected.metabuffer_start, end: selected.metabuffer_end, colorTag: '{cyan-fg}' });
            }
            const bar = renderBufferBar(regions, total, barLength);
            metadataLines.push(`Buffer: [${bar}]`);
            metadataLines.push(`        {yellow-fg}█{/yellow-fg} asset, {cyan-fg}█{/cyan-fg} metabuffer`);
        }

        metadataLines.push('---------------------------------');

        // Show image/audio specific metadata
        switch (selected.type) {
            case 'image':
                if (imgmeta.atlassed) metadataLines.push(`Atlassed: Yes (${imgmeta.atlasid})`);
                else metadataLines.push(`Atlassed: No`);
                if (imgmeta.width) metadataLines.push(`Width: ${imgmeta.width} `);
                if (imgmeta.height) metadataLines.push(`Height: ${imgmeta.height} `);
                // Only show Atlas ID for images
                if (imgmeta.atlasid !== undefined && selected.type === 'image') metadataLines.push(`Atlas ID: ${imgmeta.atlasid} `);
                for (const [key, value] of Object.entries(imgmeta)) {
                    metadataLines.push(`${key}: ${JSON.stringify(value)}`);
                }
                if (imgmeta.atlassed && imgmeta.texcoords) {
                    const atlasName = imgmeta.atlasid === 0 ? '_atlas' : `_atlas${imgmeta.atlasid} `;
                    const atlasAsset = assetList.find(a => a.resname === atlasName && a.type === 'image');
                    if (atlasAsset) {
                        const atlasBuf = atlasAsset.buffer instanceof Uint8Array
                            ? Buffer.from(atlasAsset.buffer)
                            : Buffer.from(rompack.slice(atlasAsset.start, atlasAsset.end));
                        try {
                            const atlasPng = PNG.sync.read(atlasBuf);
                            const [sx, sy, sw, sh] = imgmeta.texcoords as number[];
                            // Convert normalized texcoords to pixel dimensions
                            let width = Math.floor(sw * atlasPng.width);
                            let height = Math.floor(sh * atlasPng.height);
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
                    try {
                        const png = PNG.sync.read(
                            Buffer.isBuffer(selected.buffer)
                                ? selected.buffer
                                : Buffer.from(selected.buffer)
                        );
                        let width = imgmeta.width || png.width;
                        let height = imgmeta.height || png.height;
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
                break;
            case 'audio':
                // For audio, we don't generate ASCII art, just show the name
                // asciiArt = '[Audio asset, no ASCII preview]';

                if (audiometa.audiotype === 'music') {
                    metadataLines.push(`Audio type: Music`);
                    if (audiometa.loop !== undefined && audiometa.loop !== null) {
                        metadataLines.push(`Loop position: ${audiometa.loop}`);
                    }
                    else {
                        metadataLines.push(`Loop: Nein`);
                    }
                }
                else if (audiometa.audiotype === 'sfx') {
                    metadataLines.push(`Audio type: SFX`);
                    break;
                }
                metadataLines.push(`Priority: ${audiometa.priority ?? 'Unset!'}`);
            case 'source':
            case 'code':
                // For code, we don't generate ASCII art, just show the name
                // asciiArt = '[Code asset, no ASCII preview]';
                break;
        }
        metadataLines.push('');
        const modal = blessed.box({
            parent: screen,
            top: 'center', left: 'center',
            width: '80%', height: 'shrink',
            border: 'line', style: { border: { fg: 'yellow' }, bg: 'black' },
            label: `Asset: ${selected.resname} `,
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

    // Add this after creating the screen:
    const filterBox = blessed.textbox({
        parent: screen,
        top: 'center', left: 'center',
        width: '50%', height: 'shrink',
        inputOnFocus: true,
        style: { fg: 'white', bg: 'blue' },
        label: 'Filter (press f to focus, Enter to apply, Esc to clear)',
        tags: true,
        border: 'line',
        value: '',
        visible: false,
    });

    // Helper to filter assets
    function getFilteredAssets(assetList, filter: string) {
        if (!filter) return assetList;
        const f = filter.toLowerCase();
        return assetList.filter(a =>
            (a.resname && a.resname.toLowerCase().includes(f)) ||
            (a.type && a.type.toLowerCase().includes(f))
        );
    }

    // Function to update the table based on filter
    function updateTable(filter: string = undefined) {
        const filtered = getFilteredAssets(assetList, filter);
        const tableRows = filtered.map(asset => [
            asset.resname ? String(asset.resname) : '',
            asset.resid ? String(asset.resid) : '',
            asset.type ? String(asset.type) : '',
            (() => {
                let size = 0;
                if (asset.start != null && asset.end != null) size += asset.end - asset.start;
                if (asset.metabuffer_start != null && asset.metabuffer_end != null) size += asset.metabuffer_end - asset.metabuffer_start;
                // Compute percentage of total rompack size
                if (size < 1024) return `${size} B`;
                if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
                if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
            })()
        ]);
        table.setData({
            headers: ['Name', 'ID', 'Type', 'Size'],
            data: tableRows
        });
        screen.render();
    }

    // Focus filter box on `/ `
    screen.key('f', () => {
        filterBox.show();
        filterBox.focus();
        screen.render();
    });

    // Apply filter on Enter
    filterBox.on('submit', (filterValue) => {
        updateTable(filterValue);
        filterBox.hide();
        table.focus();
        screen.render();
    });

    // Clear filter on Esc
    filterBox.on('cancel', () => {
        filterBox.setValue('');
        updateTable('');
        filterBox.hide();
        table.focus();
        screen.render();
    });

    // Initialize table with all assets
    updateTable('');
    filterBox.hide(); // Hide filter box initially

    // Redraw summary bar on resize
    screen.on('resize', () => {
        barLength = getBarLength(typeof screen.width === 'number' ? screen.width : 120);
        summaryBox.setContent(generateSummaryContent());
        screen.render();
    });

    screen.key(['q', 'C-c'], () => process.exit(0));
    screen.render();
}

main();
