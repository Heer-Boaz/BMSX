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

export function generateBrailleAsciiArt(
    imgBuf: Buffer | Uint8Array,
    imgW: number,
    imgH: number,
    offsetX: number,
    offsetY: number,
    atlasPng: PNG,
    modalWidth: number,
    opts: {
        useEdgeDetection?: boolean;   // default true
        useDithering?: boolean;       // default false
        strictBgDist?: number;        // sq-dist voor BG (default 32²)
        deltaLum?: number;            // |Ydiff| drempel (default 30)
    } = {}
): string {

    const useEdge = opts.useEdgeDetection ?? true;
    const useDith = opts.useDithering ?? true;
    const BG_DIST = opts.strictBgDist ?? 32 * 32;
    const DELTA = opts.deltaLum ?? 30; // luminantie 0-255

    const BRAILLE_BASE = 0x2800;
    const brailleMap = [[0, 1, 2, 5], [3, 4, 6, 7]];
    const outW = Math.min(modalWidth - 8, Math.floor(imgW / 2));
    const outH = Math.min(Math.ceil(imgH / 4), Math.floor(outW * (imgH / imgW) / 2)) + 1;

    /* ---------- gamma-correcte luminantie-buffer ---------- */
    const linY = new Float32Array(imgW * imgH);
    {
        let p = 0;
        for (let y = 0; y < imgH; ++y) {
            for (let x = 0; x < imgW; ++x, ++p) {
                const i4 = ((offsetY + y) * atlasPng.width + (offsetX + x)) << 2;
                const r = imgBuf[i4], g = imgBuf[i4 + 1], b = imgBuf[i4 + 2];
                linY[p] = 255 * (0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b));
            }
        }
    }

    /* ---------- global dominant kleur ---------- */
    const hist = new Map<number, number>();
    for (let p = 0; p < imgW * imgH; ++p) {
        const i4 = (((offsetY + (p / imgW | 0)) * atlasPng.width) + offsetX + (p % imgW)) << 2;
        if (!imgBuf[i4 + 3]) continue;                       // transparant
        const key = rgbToKey(imgBuf[i4], imgBuf[i4 + 1], imgBuf[i4 + 2]);
        hist.set(key, (hist.get(key) ?? 0) + 1);
    }
    let bgKey = 0, bgCnt = 0;
    // @ts-ignore
    for (const [k, c] of hist) if (c > bgCnt) { bgCnt = c; bgKey = k; }
    const bgR = bgKey >>> 16 & 255, bgG = bgKey >>> 8 & 255, bgB = bgKey & 255;
    const bgLum = 255 * (0.2126 * srgb2lin(bgR) + 0.7152 * srgb2lin(bgG) + 0.0722 * srgb2lin(bgB));

    /* ---------- dither buffer ---------- */
    const err = useDith ? new Float32Array(imgW * imgH) : null;

    /* ---------- render loop ---------- */
    let asciiArt = '';

    for (let cy = 0; cy < outH; ++cy) {
        let line = '';
        for (let cx = 0; cx < outW; ++cx) {

            const fgVotes = new Map<number, number>();     // stemt alleen als dot gezet
            let cellBgR = 0, cellBgG = 0, cellBgB = 0, cellBgCnt = 0;
            let bitmask = 0;

            for (let dy = 0; dy < 4; ++dy) {
                for (let dx = 0; dx < 2; ++dx) {
                    const px = Math.min(imgW - 1, cx * 2 + dx);
                    const py = Math.min(imgH - 1, cy * 4 + dy);
                    const p = py * imgW + px;
                    const idx4 = ((py + offsetY) * atlasPng.width + (px + offsetX)) << 2;
                    const r = imgBuf[idx4], g = imgBuf[idx4 + 1], b = imgBuf[idx4 + 2];

                    let yLin = linY[p];
                    const nearBg = colorDistSq(r, g, b, bgR, bgG, bgB) < BG_DIST;
                    const ditherThisPixel = useDith && !nearBg;   // BG nooit diffusen
                    if (ditherThisPixel && err) yLin = clamp(yLin + err[p], 0, 255);

                    /* edge-aware Δ-drempel (trekt Δ iets naar beneden op randen) */
                    let deltaThr = DELTA;
                    if (useEdge) deltaThr = Math.max(10, DELTA - 0.2 * sobelAt(linY, imgW, imgH, px, py));

                    const lumDiff = Math.abs(yLin - bgLum);
                    const dotSet = !nearBg && lumDiff >= deltaThr;

                    if (dotSet) {
                        bitmask |= 1 << brailleMap[dx][dy];
                        const key = rgbToKey(r, g, b);
                        fgVotes.set(key, (fgVotes.get(key) ?? 0) + 1);
                    }

                    if (nearBg) { cellBgR += r; cellBgG += g; cellBgB += b; ++cellBgCnt; }

                    if (ditherThisPixel && err) {
                        const target = dotSet ? 0 : 255;
                        distributeError(err, yLin - target, p, imgW, imgH);
                    }
                }
            }

            /* dominante FG-kleur o.b.v. gezette dots */
            let domKey = 0x808080, domCnt = 0;
            // @ts-ignore
            for (const [k, c] of fgVotes) if (c > domCnt) { domCnt = c; domKey = k; }

            const fgTag = `{${keyToHex(domKey)}-fg}`;
            const bgTag = cellBgCnt
                ? `{#${hex(cellBgR / cellBgCnt)}${hex(cellBgG / cellBgCnt)}${hex(cellBgB / cellBgCnt)}-bg}`
                : '';

            line += bgTag + fgTag + String.fromCharCode(BRAILLE_BASE + bitmask) + '{/}';
        }
        asciiArt += line + '\n';
    }
    return asciiArt;
}

function srgb2lin(v: number) { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }
function hex(v: number) { return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'); }
function clamp(x: number, l: number, h: number) { return x < l ? l : x > h ? h : x; }
function rgbToKey(r: number, g: number, b: number) { return (r << 16) | (g << 8) | b; }
function keyToHex(k: number) { return `#${(k >>> 16 & 0xff).toString(16).padStart(2, '0')}${(k >>> 8 & 0xff).toString(16).padStart(2, '0')}${(k & 0xff).toString(16).padStart(2, '0')}`; }
function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return dr * dr + dg * dg + db * db;
}

function sobelAt(buf: Float32Array, w: number, h: number, x: number, y: number): number {
    const xm1 = Math.max(0, x - 1), xp1 = Math.min(w - 1, x + 1);
    const ym1 = Math.max(0, y - 1), yp1 = Math.min(h - 1, y + 1);
    const i = y * w + x;
    const gx = buf[ym1 * w + xp1] + 2 * buf[i + 1] + buf[yp1 * w + xp1]
        - buf[ym1 * w + xm1] - 2 * buf[i - 1] - buf[yp1 * w + xm1];
    const gy = buf[yp1 * w + xm1] + 2 * buf[yp1 * w + x] + buf[yp1 * w + xp1]
        - buf[ym1 * w + xm1] - 2 * buf[ym1 * w + x] - buf[ym1 * w + xp1];
    return Math.sqrt(gx * gx + gy * gy);
}

function distributeError(buf: Float32Array, e: number, idx: number, w: number, h: number) {
    const x = idx % w, y = Math.floor(idx / w);
    if (x + 1 < w) buf[idx + 1] += e * 7 / 16;
    if (x > 0 && y + 1 < h) buf[idx + w - 1] += e * 3 / 16;
    if (y + 1 < h) buf[idx + w] += e * 5 / 16;
    if (x + 1 < w && y + 1 < h) buf[idx + w + 1] += e * 1 / 16;
}
