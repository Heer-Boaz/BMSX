#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile>

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import * as fs from 'fs/promises';
import * as pako from 'pako';
import { PNG } from 'pngjs';
import { decodeBinary } from '../src/bmsx/binencoder';
import type { AudioMeta, ImgMeta } from '../src/bmsx/rompack';

const PER_PIXEL_RENDERING_THRESHOLD = 64; // sprites ≤64×64 get per-pixel rendering

let modal: blessed.Widgets.BoxElement | null = null;
let filteredAssetList: any[] = [];

function byteSizeToString(size: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    let i = 0;
    let n = size;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return i === 0 ? `${size} ${units[0]}` : `${n.toFixed(2)} ${units[i]}`;
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
        if (raw && raw.length >= 2 && raw[0] === 0x1F && raw[1] === 0x8B) {
            return true;
        }
        // Zlib: 78 01 / 78 9C / 78 DA (common), but also check CMF/FLG validity
        if (raw && raw.length >= 2 && raw[0] === 0x78) {
            const cmf = raw[0], flg = raw[1];
            if ((cmf * 256 + flg) % 31 === 0) {
                return true;
            }
        }
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
            const msg = e && typeof e.message === 'string' ? e.message : String(e);
            console.error(`Failed to decompress ROM: ${msg}`);
            console.error(e?.stack ?? 'No stack trace available');
            // process.exit(1);
            decompressed = null; // fallback to null if decompression fails
        }
        rompack = decompressed ?? raw; // Use decompressed data if available, otherwise fallback to raw
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
    // ROM must be at least 16 bytes and not suspiciously huge
    if (rompack.length > 1024 * 1024 * 1024) {
        console.error('ROM file is suspiciously large (>1GB), aborting.');
        process.exit(1);
    }
    const footer = rompack.slice(rompack.length - 16);
    if (footer.length < 16) {
        console.error('ROM footer is too short, invalid ROM file.');
        process.exit(1);
    }
    function readLE64(buf: Uint8Array, offset: number): bigint {
        // Validate offset
        if (offset < 0 || offset + 8 > buf.length) {
            throw new Error('Invalid offset for LE64 read');
        }
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
    // Validate metadataOffset and metadataLength
    if (
        !Number.isFinite(metadataOffset) ||
        !Number.isFinite(metadataLength) ||
        metadataOffset < 0 ||
        metadataLength < 0 ||
        metadataOffset + metadataLength > rompack.length ||
        metadataOffset > rompack.length - 16
    ) {
        console.error(`Invalid metadata offset or length: offset=${metadataOffset} (${byteSizeToString(metadataOffset)}), length=${metadataLength} (${byteSizeToString(metadataLength)})`);
        process.exit(1);
    }
    const metaBuf = rompack.slice(metadataOffset, metadataOffset + metadataLength);
    if (!metaBuf || metaBuf.length === 0) {
        console.error('No metadata found in ROM file, invalid ROM file.');
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
    const codeCount = assetList.filter(a => a.type === 'source')?.length ?? 0;
    const otherCount = assetList.filter(a => a.type !== 'image' && a.type !== 'audio' && a.type !== 'source')?.length ?? 0;

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
        unfilteredRegions: Array<{ start: number; end: number; colorTag: string }>,
        totalSize: number,
        barLength: number
    ): string {
        const blocks = ['?', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
        const cellSize = totalSize / barLength;
        const defaultCellChar = ' ';
        const cellChars = new Array(barLength).fill(defaultCellChar);
        const cellColors = new Array(barLength).fill('');

        // Filter out empty regions (start === end === 0)
        const regions = unfilteredRegions.filter(region => region.start !== 0 || region.end !== 0);

        const toBackground = (colorTag: string) => {
            // Convert color tag to background color by replacing -fg with -bg
            return colorTag.replace('-fg}', '-bg}');
        }

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
                    if (idx <= 1) {
                        // Fill the one character by computing the whether the region is more left, middle, or right
                        const leftFrac = (regionStart - cellStart) / cellSize;
                        const rightFrac = (cellEnd - regionEnd) / cellSize;

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
                        // If there is any overlapping region, we ignore this region
                        if (fgColor !== '{black-fg}') continue;

                        // Determine whether to use left, right, or middle character
                        if (leftFrac < rightFrac - 0.20) {
                            cellChars[startCell] = '▏'; // left
                        } else if (leftFrac > rightFrac + 0.20) {
                            cellChars[startCell] = '▕'; // right
                        } else {
                            cellChars[startCell] = '│'; // true middle (vertical bar)
                        }

                        cellColors[startCell] = region.colorTag;
                    }
                    else if (idx >= 8) {
                        cellChars[startCell] = blocks[idx];
                        cellColors[startCell] = region.colorTag;
                    }
                    else {
                        cellChars[startCell] = blocks[idx];
                        let overlappingRegion = null;
                        // Find the highest-priority overlapping region's colorTag for fg
                        let fgColor = '{black-fg}';
                        for (const r of regions) {
                            // Only check other regions, not the current one
                            if (r === region) continue;
                            // Check if this region overlaps with the current cell
                            if (r.start < cellEnd && r.end > cellStart) {
                                fgColor = r.colorTag;
                                overlappingRegion = r;
                                break;
                            }
                        }
                        // Invert colors **only** if the overlapping region starts before the current region ends (not the cell!)
                        if (overlappingRegion && overlappingRegion.start < region.end) {
                            cellColors[startCell] = toBackground(region.colorTag) + fgColor;
                        }
                        else {
                            // No overlapping region, use the region's colorTag
                            cellColors[startCell] = region.colorTag;
                        }
                    }
                }/* ── left boundary (multi-cell branch) ─────────────────────────────── */
                else {                                    // we are inside:  if (startCell !== endCell)
                    const coverage = 1 - leftFrac;
                    const idx = Math.round(coverage * 8);

                    /* ← NEW: handle ultra-thin sliver */
                    let needsInvert = false;
                    if (idx <= 1) {
                        cellChars[startCell] = '▕';       // thin right-hand bar
                    } else if (idx <= 3) {
                        cellChars[startCell] = '▐';       // slightly less thin right-hand bar
                    } else {
                        cellChars[startCell] = blocks[idx];
                        needsInvert = true;
                    }

                    /* same-cell overlap, but restrict search to HIGHER-priority regions */
                    const cellStart = startCell * cellSize;
                    const cellEnd = cellStart + cellSize;
                    const higher = regions
                        .slice(0, regions.indexOf(region))          // only earlier (higher-priority) regions
                        .find(r => r.start < cellEnd && r.end > cellStart);

                    if (needsInvert) {
                        const fg = higher ? higher.colorTag : '{black-fg}';
                        cellColors[startCell] = toBackground(region.colorTag) + fg;   // bg = region, fg = higher/black
                    } else {
                        cellColors[startCell] = region.colorTag;
                    }
                }
            }
            /* ── right boundary ────────────────────────────────────────────────── */
            if (endCell !== startCell && cellChars[endCell] === defaultCellChar) {
                const idx = Math.round(rightFrac * 8);

                /* The region occupies the **left** side of this cell, so the glyph
                   already points the correct way.  No inversion is needed. */
                if (idx === 0) {
                    cellChars[endCell] = '▏'; // 1/8 left block
                } else {
                    cellChars[endCell] = blocks[idx];
                }

                /* Plain colouring: foreground = region colour, background untouched. */
                cellColors[endCell] = region.colorTag;
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
            }, audio: ${audioCount}, code: ${codeCount}, other: ${otherCount}) \n` +
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
        columnSpacing: 2,
        columnWidth: [30, 5, 10, 10],
        keys: true,
        interactive: 'true',
        label: 'Select asset (Enter to view details, q to quit)',
        border: { type: 'line', fg: 'blue' },
        style: {
            header: { fg: 'white', bg: 'blue' },
            cell: { fg: 'white', bg: 'black' },
            focus: { border: { fg: 'yellow' } },
        },
        mouse: true,
        scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'yellow' } },
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

    // Initialize filteredAssetList before first use
    filteredAssetList = assetList;

    // Function to update the table based on filter
    function updateTable(filter: string = undefined) {
        filteredAssetList = getFilteredAssets(assetList, filter);
        const tableRows = filteredAssetList.map(asset => [
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

    // Use table.rows for selection events (works for both mouse and keyboard)
    (table as any).rows.on('select', (item, idx) => {
        showAssetModal(idx);
    });

    // Helper to show asset modal by index
    function showAssetModal(idx: number) {
        const selected = filteredAssetList[idx];
        const imgmeta = selected.imgmeta || {} as ImgMeta;
        const audiometa = selected.audiometa || {} as AudioMeta;
        let bufferSize = selected.end - selected.start;
        let asciiArt = '';
        const metadataLines = [];

        if (modal) {
            modal.destroy();
            modal = null;
        }
        modal = blessed.box({
            parent: screen,
            top: 'center', left: 'center',
            width: '80%', height: '80%',
            border: 'line', style: { border: { fg: 'yellow' }, bg: 'black' },
            label: `Asset - Name: ${selected.resname} | ID: ${selected.resid} | Type: ${selected.type}`,
            tags: true, scrollable: true, alwaysScroll: true, keys: true, mouse: true, draggable: true,
            vi: true, input: true, // Enable vi-style keybindings
            scrollbar: { ch: '|', track: { bg: 'grey' }, style: { bg: 'yellow' } }
        });

        // Show image/audio specific metadata
        switch (selected.type) {
            case 'image':
                if (imgmeta.atlassed && imgmeta.texcoords) {
                    const atlasName = imgmeta.atlasid === 0 ? '_atlas' : `_atlas${imgmeta.atlasid} `;
                    const atlasAsset = assetList.find(a => a.resname === atlasName && a.type === 'image');
                    if (atlasAsset) {
                        const atlasBuf = atlasAsset.buffer instanceof Uint8Array
                            ? Buffer.from(atlasAsset.buffer)
                            : Buffer.from(rompack.slice(atlasAsset.start, atlasAsset.end));
                        const modalWidth = (modal?.width ?? 80) as number;

                        try {
                            asciiArt = generateAsciiArtFromImageInCanvas(atlasBuf, imgmeta, modalWidth);
                        } catch (e: any) {
                            asciiArt = `Failed to decode atlas PNG: ${e.message}\n`;
                        }
                    } else {
                        asciiArt = '[Atlas asset not found]';
                    }
                    if (imgmeta.width) metadataLines.push(`Size: ${imgmeta.width}x${imgmeta.height} `);
                    // Only show Atlas ID for images
                    for (const [key, value] of Object.entries(imgmeta)) {
                        metadataLines.push(`${key}: ${JSON.stringify(value)}`);
                    }
                } else {
                    asciiArt = '[Unable to generate ASCII preview]';
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
                break;
        }

        // Show generic metadata details
        const bufferLines = [];
        const metabufferSize = selected.metabuffer_end - selected.metabuffer_start;
        if (bufferSize || metabufferSize) {
            const barLength = getBarLength(modal?.width as number);
            const total = rompack.length;
            // Compose regions for this asset: asset, metabuffer, global metadata
            const regions = [];
            const bufferRegionColor = '{red-fg}';
            const bufferRegionColorCloseTag = bufferRegionColor.replace('{', '{/');
            const metabufferRegionColor = '{blue-fg}';
            const metabufferRegionColorCloseTag = bufferRegionColor.replace('{', '{/');
            if (selected.start !== undefined && selected.end !== undefined) {
                regions.push({ start: selected.start, end: selected.end, colorTag: bufferRegionColor });
            }
            if (selected.metabuffer_start !== undefined && selected.metabuffer_end !== undefined) {
                regions.push({ start: selected.metabuffer_start, end: selected.metabuffer_end, colorTag: metabufferRegionColor });
            }
            const bar = renderBufferBar(regions, total, barLength);
            bufferLines.push(`Buffer: [${bar}]`);
            bufferLines.push(`        ${bufferRegionColor}█${bufferRegionColorCloseTag} buffer, ${metabufferRegionColor}█${metabufferRegionColorCloseTag} metabuffer`);
            if (bufferSize) bufferLines.push(`Buffer: ${selected.start} - ${selected.end} (${byteSizeToString(bufferSize)})`);
            // Metabuffer region info
            if (metabufferSize) bufferLines.push(`Metabuffer: ${selected.metabuffer_start} - ${selected.metabuffer_end} (${byteSizeToString(metabufferSize)})`);
            if (bufferSize && metabufferSize) {
                const totalSize = (bufferSize ?? 0) + (metabufferSize ?? 0);
                bufferLines.push(`Total size: ${byteSizeToString(totalSize)}`);
            }
        }

        metadataLines.push('');
        modal.content = `${bufferLines.join('\n')}\n${asciiArt}\n${metadataLines.join('\n')}\n`;
        modal.focus();
        let ignoreFirstKeypress = true;
        let currentIdx = idx;
        modal.on('keypress', (ch, key) => {
            if (key.name === 'left' || key.name === 'right') {
                // Change selection left/right
                if (key.name === 'left' && currentIdx > 0) {
                    currentIdx--;
                    (table as any).rows.select(currentIdx); // update table selection
                    showAssetModal(currentIdx);
                } else if (key.name === 'right' && currentIdx < filteredAssetList.length - 1) {
                    currentIdx++;
                    (table as any).rows.select(currentIdx); // update table selection
                    showAssetModal(currentIdx);
                }
                return;
            }
            if (key.name === 'up' || key.name === 'down') {
                return;
            }
            if (ignoreFirstKeypress) {
                ignoreFirstKeypress = false;
                return;
            }
            modal.destroy();
            modal = null; // Clear modal reference
            screen.render();
        });
        screen.render();
    }

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

// Helper functions for dominant color detection
function rgbToKey(r, g, b) {
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}
function keyToHex(key) {
    return '#' + ((key >> 16) & 0xff).toString(16).padStart(2, '0') +
        ((key >> 8) & 0xff).toString(16).padStart(2, '0') +
        (key & 0xff).toString(16).padStart(2, '0');
}
// Helper for color distance
function colorDistSq(r1, g1, b1, r2, g2, b2) {
    return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

main();

function generateAsciiArtFromImageInCanvas(atlasBuf: Buffer, imgmeta: ImgMeta, modalWidth: number): string {
    let asciiArt = '';

    const atlasPng = PNG.sync.read(atlasBuf); // TODO: handle png not part of atlas
    // ASCII-art generator with correct scoping
    let imgBuf, imgW, imgH, offsetX = 0, offsetY = 0;
    imgBuf = atlasPng.data;
    if (imgmeta.atlassed && imgmeta.texcoords) {
        // Suppose imgmeta.texcoords has 12 floats: 6 vertices in clip space (x,y).
        const coords = imgmeta.texcoords as number[]; // e.g. [-1, -1, 1, -1, …]
        const xs = [coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]];
        const ys = [coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]];

        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);

        // Convert from clip space (−1..1) to 0..1 space:
        const sx = minX;
        const sy = minY;
        const rx = maxX;
        const by = maxY;

        // Then compute your region for ASCII art:
        offsetX = Math.floor(sx * atlasPng.width);
        offsetY = Math.floor(sy * atlasPng.height);
        imgW = Math.floor((rx - sx) * atlasPng.width);
        imgH = Math.floor((by - sy) * atlasPng.height);
    } else if (atlasPng) { // If not atlassed, use the full PNG
        imgW = atlasPng.width;
        imgH = atlasPng.height;
    }

    if (!imgBuf || !imgW || !imgH) return '[Invalid image data]';
    // If the image is too large, we will not render it pixel-perfect
    if (imgW <= PER_PIXEL_RENDERING_THRESHOLD && imgH <= PER_PIXEL_RENDERING_THRESHOLD) {
        return generatePixelPerfectAsciiArt(imgBuf, imgW, imgH, offsetX, offsetY, atlasPng.width);
    }

    // Advanced braille 2×4 subpixel rendering with dynamic thresholding and optional edge detection
    return generateBrailleAsciiArt(imgBuf, imgW, imgH, offsetX, offsetY, atlasPng, modalWidth);
}

// Extracted function for pixel-perfect ASCII art rendering
function generatePixelPerfectAsciiArt(
    imgBuf: Buffer | Uint8Array,
    imgW: number,
    imgH: number,
    offsetX: number,
    offsetY: number,
    atlasWidth: number
): string {
    let asciiArt = '';
    for (let y = 0; y < imgH; y++) {
        let line = '';
        for (let x = 0; x < imgW; x++) {
            const px = offsetX + x;
            const py = offsetY + y;
            const idx4 = (py * atlasWidth + px) << 2;
            const r = imgBuf[idx4], g = imgBuf[idx4 + 1], b = imgBuf[idx4 + 2], a = imgBuf[idx4 + 3];
            if (a < 64) {
                // transparent pixel, render as space
                line += ' ';
            }
            else {
                line += `{#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}-bg} {/}`;
            }
        }
        asciiArt += line + '\n';
    }
    return asciiArt;
}

function generateBrailleAsciiArt(
    imgBuf: Buffer | Uint8Array,
    imgW: number,
    imgH: number,
    offsetX: number,
    offsetY: number,
    atlasPng: PNG,
    modalWidth: number
): string {
    let asciiArt = '';
    const outW = Math.min(modalWidth - 8, Math.floor(imgW / 2));
    const outH = Math.min(Math.ceil(imgH / 4), Math.floor(outW * (imgH / imgW) / 2)) + 1;
    const BRAILLE_BASE = 0x2800;
    const brailleMap = [
        [0, 1, 2, 5], // col=0 => bits for rows 0..3
        [3, 4, 6, 7],  // col=1 => bits for rows 0..3
    ];
    const useEdgeDetection = true; // Set to false to disable Sobel edge enhancement
    // 1. Compute dominant color for the whole image region (histogram)
    const globalColorCounts = new Map();
    for (let y = 0; y < imgH; y++) {
        for (let x = 0; x < imgW; x++) {
            const px = offsetX + x;
            const py = offsetY + y;
            const idx4 = (py * atlasPng.width + px) << 2;
            const r = imgBuf[idx4], g = imgBuf[idx4 + 1], b = imgBuf[idx4 + 2], a = imgBuf[idx4 + 3];
            if (a === 0) continue;
            const key = rgbToKey(r, g, b);
            globalColorCounts.set(key, (globalColorCounts.get(key) || 0) + 1);
        }
    }
    let globalDominantKey = 0x808080, globalMaxCount = 0;
    for (const [key, count] of Array.from(globalColorCounts.entries())) {
        if (count > globalMaxCount) {
            globalMaxCount = count;
            globalDominantKey = key;
        }
    }
    const globalDomR = (globalDominantKey >> 16) & 0xff;
    const globalDomG = (globalDominantKey >> 8) & 0xff;
    const globalDomB = globalDominantKey & 0xff;

    for (let y = 0; y < outH; y++) {
        let line = '';
        for (let x = 0; x < outW; x++) {
            let bitmask = 0;
            // For dominant color
            const colorCounts = new Map();
            let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
            let fgCount = 0;
            // Build a 2x4 luminance matrix for this braille cell
            const lumMatrix: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
            const lumList: number[] = [];
            for (let dy = 0; dy < 4; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const relX = Math.min(imgW - 1, x * 2 + dx);
                    const relY = Math.min(imgH - 1, y * 4 + dy);
                    const px = offsetX + relX;
                    const py = offsetY + relY;
                    const idx4 = (py * atlasPng.width + px) << 2;
                    const r = imgBuf[idx4], g = imgBuf[idx4 + 1], b = imgBuf[idx4 + 2], a = imgBuf[idx4 + 3];
                    const lum = a === 0 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
                    lumMatrix[dx][dy] = lum;
                    lumList.push(lum);
                    // Classify as background if close to global dominant color
                    if (colorDistSq(r, g, b, globalDomR, globalDomG, globalDomB) < 32 * 32) {
                        bgR += r; bgG += g; bgB += b; bgCount++;
                    } else {
                        // Count color for dominant color detection
                        const key = rgbToKey(r, g, b);
                        colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
                        fgCount++;
                    }
                }
            }
            // Local contrast for this cell
            const minLum = Math.min(...lumList);
            const maxLum = Math.max(...lumList);
            const localContrast = maxLum - minLum;
            const meanLum = lumList.reduce((a, b) => a + b, 0) / lumList.length;
            const baseThresh = 0.75;
            const contrastFactor = 1 - Math.min(1, localContrast / 255);
            const modThresh = baseThresh + contrastFactor * 0.15;
            // Sobel edge detection (optional)
            let edgeMatrix: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
            if (useEdgeDetection) {
                // Pad with neighbors or clamp for 3x3 window
                const getLum = (dx, dy) => {
                    const x_ = Math.max(0, Math.min(1, dx));
                    const y_ = Math.max(0, Math.min(3, dy));
                    return lumMatrix[x_][y_];
                };
                // For each pixel in 2x4, compute Sobel magnitude using 3x3 window
                for (let dx = 0; dx < 2; dx++) {
                    for (let dy = 0; dy < 4; dy++) {
                        // 3x3 Sobel kernels
                        const sobelX = [
                            [-1, 0, 1],
                            [-2, 0, 2],
                            [-1, 0, 1]
                        ];
                        const sobelY = [
                            [1, 2, 1],
                            [0, 0, 0],
                            [-1, -2, -1]
                        ];
                        let sumX = 0, sumY = 0;
                        for (let i = -1; i <= 1; i++) {
                            for (let j = -1; j <= 1; j++) {
                                const val = getLum(dx + i, dy + j);
                                sumX += val * sobelX[i + 1][j + 1];
                                sumY += val * sobelY[i + 1][j + 1];
                            }
                        }
                        edgeMatrix[dx][dy] = Math.sqrt(sumX * sumX + sumY * sumY);
                    }
                }
            }
            // --- Spatial-pattern-based bitmask ---
            // For each dot, set if it is foreground (not background)
            for (let dy = 0; dy < 4; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    // Use adaptive luminance thresholding for dot activation
                    const relX = Math.min(imgW - 1, x * 2 + dx);
                    const relY = Math.min(imgH - 1, y * 4 + dy);
                    const px = offsetX + relX;
                    const py = offsetY + relY;
                    const idx4 = (py * atlasPng.width + px) << 2;
                    const r = imgBuf[idx4], g = imgBuf[idx4 + 1], b = imgBuf[idx4 + 2], a = imgBuf[idx4 + 3];
                    const lum = a === 0 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
                    // If not close to global background, set the dot
                    // Now also use adaptive thresholding: if luminance is below modThresh * 255, set dot
                    if (
                        colorDistSq(r, g, b, globalDomR, globalDomG, globalDomB) >= 32 * 32 ||
                        (colorDistSq(r, g, b, globalDomR, globalDomG, globalDomB) >= 16 * 16 && lum < modThresh * 255)
                    ) {
                        bitmask |= 1 << brailleMap[dx][dy];
                    }
                }
            }

            // Find dominant color for foreground
            let dominantKey = 0x808080, maxCount = 0;
            for (const [key, count] of Array.from(colorCounts.entries())) {
                if (count > maxCount) {
                    maxCount = count;
                    dominantKey = key;
                }
            }
            const fgTag = `${keyToHex(dominantKey)}-fg`;
            const bgTag = bgCount
                ? `#${Math.round(bgR / bgCount).toString(16).padStart(2, '0')}` +
                `${Math.round(bgG / bgCount).toString(16).padStart(2, '0')}` +
                `${Math.round(bgB / bgCount).toString(16).padStart(2, '0')}-bg`
                : '';

            let ch: string;;
            if (fgCount >= 8) {
                // If all pixels are foreground, use full block
                ch = '▒';
            } else {
                ch = String.fromCharCode(BRAILLE_BASE + bitmask);
            }
            line += `${bgTag ? `{${bgTag}}` : ''}${fgTag ? `{${fgTag}}` : ''}${ch}{/}`;
        }
        asciiArt += line + '\n';
    }
    return asciiArt;
}
