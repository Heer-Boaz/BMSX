#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile>

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import * as fs from 'fs/promises';
import * as pako from 'pako';
import { PNG } from 'pngjs';
import type { AudioMeta, ImgMeta, RomAsset, RomMeta } from '../src/bmsx/rompack';
import { asciiWaveBraille, generateBrailleAsciiArt, generatePixelPerfectAsciiArt, parseWav, renderBufferBar, renderSummaryBar } from './asciiart';
import { loadAssetList, parseMetaFromBuffer } from './bootrom';

const PER_PIXEL_RENDERING_THRESHOLD = 64; // sprites ≤64×64 get per-pixel rendering

let modal: blessed.Widgets.BoxElement | null = null;
let filteredAssetList: RomAsset[] = [];
let assetList: RomAsset[] = [];

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

function decodeuint8arr(buf: Uint8Array): string {
    return new TextDecoder().decode(buf);
}

async function nodeImageLoader(buffer: ArrayBuffer) {
    return PNG.sync.read(Buffer.from(buffer.slice(0)));
}

async function loadAudio(buffer: ArrayBuffer) {
    return buffer.slice(0);
}

async function loadSourceFromBuffer(buf: ArrayBuffer): Promise<string> {
    if (!(buf instanceof ArrayBuffer)) {
        console.error('loadSourceFromBuffer expects an ArrayBuffer, got:', buf);
        throw new Error('Invalid buffer type');
    }
    if (buf.byteLength === 0) {
        console.error('loadSourceFromBuffer received an empty buffer');
        return '';
    }
    // If the buffer is already a string, return it directly
    if (typeof buf === 'string') {
        return buf;
    }

    // First create a copy of the ArrayBuffer to avoid issues with shared memory
    console.info(`Creating a copy of the ArrayBuffer for decoding... (${byteSizeToString(buf.byteLength)} bytes)`);
    let copyBuffer = new ArrayBuffer(buf.byteLength);
    copyBuffer = buf.slice(0);

    console.info(`Decoding ArrayBuffer of size ${byteSizeToString(copyBuffer.byteLength)} bytes...`);

    // Use TextDecoder to decode the ArrayBuffer directly
    const decoded = decodeuint8arr(new Uint8Array(copyBuffer));

    console.info(`Decoded ArrayBuffer to string of length ${decoded.length} characters.`);
    return decoded;
}

async function loadAssets(rompack: Buffer | ArrayBuffer) {
    let assets: RomAsset[] = [];
    try {
        const arrayBuffer = rompack instanceof ArrayBuffer ? rompack : rompack.buffer.slice(rompack.byteOffset, rompack.byteOffset + rompack.byteLength);
        // Load the ROM pack metadata using the loadResources function
        console.log('Loading ROM pack metadata...');
        if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
            console.error('Invalid metadata format: expected an ArrayBuffer');
            process.exit(1);
        }
        if (arrayBuffer.byteLength < 16) {
            console.error('Metadata buffer is too short, expected at least 16 bytes');
            process.exit(1);
        }
        // Load the ROM pack metadata using the loadResources function
        console.log('Extracting ROM pack metadata...');
        // Use the nodeImageLoader to load images from the buffer
        // Note: loadResources will handle the image loading using the provided nodeImageLoader
        console.log('Loading resources from metadata buffer...');
        // Ensure nodeImageLoader is a function that can handle ArrayBuffer input
        if (typeof nodeImageLoader !== 'function') {
            console.error('nodeImageLoader must be a function that accepts an ArrayBuffer');
            process.exit(1);
        }
        assets = await loadAssetList(rompack);

        console.log('ROM pack metadata and resources loaded successfully.');

        console.log(`Extracted ${assets.length} assets from ROM pack.`);
    } catch (e: any) {
        console.error(`Failed to decode metadata: ${e.message}`);
        console.error(e?.stack ?? 'No stack trace available');
        process.exit(1);
    }
    return assets;
}

function getMetadataBuffer(rompack: Buffer | ArrayBuffer, rommeta: RomMeta) {
    const metadataOffset = rommeta.start;
    const metadataLength = rommeta.end - rommeta.start;
    // Validate metadataOffset and metadataLength
    if (
        !Number.isFinite(metadataOffset) ||
        !Number.isFinite(metadataLength) ||
        metadataOffset < 0 ||
        metadataLength < 0 ||
        metadataOffset + metadataLength > rompack.byteLength ||
        metadataOffset > rompack.byteLength - 16
    ) {
        console.error(`Invalid metadata offset or length: offset=${metadataOffset} (${byteSizeToString(metadataOffset)}), length=${metadataLength} (${byteSizeToString(metadataLength)})`);
        process.exit(1);
    }

    const metaBuf = rompack.slice(metadataOffset, metadataOffset + metadataLength);
    if (!metaBuf || metaBuf.byteLength === 0) {
        console.error('No metadata found in ROM file, invalid ROM file.');
        process.exit(1);
    }
    if (metaBuf.byteLength !== metadataLength) {
        console.error(`Metadata length mismatch: expected ${metadataLength} bytes, got ${metaBuf.byteLength} bytes`);
        process.exit(1);
    }
    console.log(`Metadata buffer loaded: offset=${metadataOffset} (${byteSizeToString(metadataOffset)}), length=${metadataLength} (${byteSizeToString(metadataLength)})`);
    return { metaBuf, metadataOffset, metadataLength };
}

async function loadRompackFromFile(romfile: string): Promise<Buffer> {
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
        throw new Error(`Failed to read ROM file at "${romfile}": ${error?.message || 'Unknown error'}`);
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
        rompack = decompressed.buffer ?? raw; // Use decompressed data if available, otherwise fallback to raw
        console.log(`Decompressed ROM size: ${byteSizeToString(rompack.byteLength)}`);
    } else {
        console.log('ROM is uncompressed, using as-is.');
        rompack = raw;
    }
    if (!rompack) {
        throw new Error('ROM pack is empty or invalid after decompression.');
    }
    return rompack;
}

async function main() {
    const romfile = process.argv[2];
    if (!romfile) {
        console.error('Usage: npx tsx scripts/rominspector.ts <romfile>');
        process.exit(1);
    }

    // Load the ROM pack from the specified file
    let rompack: Buffer | ArrayBuffer;
    try {
        rompack = await loadRompackFromFile(romfile);
    } catch (e: any) {
        console.error(`Failed to load ROM file "${romfile}": ${e.message}`);
        console.error(e?.stack ?? 'No stack trace available');
        process.exit(1);
    }

    const rommeta = parseMetaFromBuffer(rompack);
    if (!rommeta || !rommeta.start || !rommeta.end) {
        console.error('Invalid ROM metadata, unable to parse ROM file.');
        process.exit(1);
    }
    console.log(`ROM metadata: start=${rommeta.start} (${byteSizeToString(rommeta.start)}), end=${rommeta.end} (${byteSizeToString(rommeta.end)}, length=${rommeta.end - rommeta.start} (${byteSizeToString(rommeta.end - rommeta.start)}))`);

    const { metaBuf, metadataOffset, metadataLength } = getMetadataBuffer(rompack, rommeta);
    assetList = await loadAssets(rompack);

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
        const totalSize = rompack.byteLength;
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
        const metaSizePercent = (metaBuf.byteLength / totalSize * 100).toFixed(1);

        return `Total assets: ${assetList?.length ?? 0} (images: ${imageAssets?.length ?? 0
            }, audio: ${audioCount}, code: ${codeCount}, other: ${otherCount}) \n` +
            `Buffer: [${renderSummaryBar(summaryRegions, totalSize, barLength)}]\n` +
            `{yellow-fg}█{/yellow-fg} image  {magenta-fg}█{/magenta-fg} audio  {white-fg}█{/white-fg} code  {cyan-fg}█{/cyan-fg} metabuffer  {blue-fg}█{/blue-fg} global metadata\n` +
            `Images size: ${byteSizeToString(imagesSize)} (${imageSizePercent}%)\n` +
            `Audio size: ${byteSizeToString(audioSize)} (${audioSizePercent}%)\n` +
            `Code size: ${byteSizeToString(codeSize)} (${codeSizePercent}%)\n` +
            `Metadata size: ${byteSizeToString(metaBuf.byteLength)} (${metaSizePercent}%)\n` +
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
    async function updateTable(filter: string = undefined) {
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
    (table as any).rows.on('select', async (item, idx) => {
        await showAssetModal(idx);
    });

    // Helper to show asset modal by index
    async function showAssetModal(idx: number) {
        const selected = filteredAssetList[idx] as RomAsset;
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

        const modalWidth = (modal?.width ?? 80) as number;

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

                        try {
                            asciiArt = generateAsciiArtFromImageInAtlas(atlasBuf, imgmeta, modalWidth);
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
                }
                metadataLines.push(`Priority: ${audiometa.priority ?? 'Unset!'}`);
                // ------ ASCII-preview toevoegen ------
                try {
                    if (!selected.buffer || !(selected.buffer instanceof ArrayBuffer) || selected.buffer.byteLength === 0) {
                        // Load the audio buffer from the ROM pack
                        selected.buffer = await loadAudio(rompack.slice(selected.start, selected.end));
                        asciiArt = '[No audio buffer available]';
                    }
                    const info = parseWav(selected.buffer as Uint8Array);
                    if (!info || !info.dataOff || !info.dataLen || !info.bits || !info.channels) {
                        asciiArt = '[Invalid WAV data]';
                        break;
                    }
                    else asciiArt = `${info.dataOff} ${info.dataLen} ${info.bits} ${info.channels}`;
                    // Fix: create a Uint8Array view for subarray
                    const pcm = new Uint8Array(selected.buffer).subarray(info.dataOff, info.dataOff + info.dataLen);

                    const scope = asciiWaveBraille(
                        pcm, info.bits, modalWidth - 10, undefined, info.channels,
                    );
                    asciiArt = scope;                          // getoond in je modal
                } catch (e) {
                    asciiArt = `(Preview failed: ${e}\n${e.stack})`;
                }
                break;
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
            const total = rompack.byteLength;
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

function extractSubimageAndSizeFromAtlassedImage(imgToExtract: Buffer, imgmeta: ImgMeta): { subimage: Buffer | null, width: number, height: number } {
    try {
        const imageToExtractPNG = PNG.sync.read(imgToExtract);
        if (!imageToExtractPNG || !imageToExtractPNG.data) return { subimage: null, width: 0, height: 0 };

        let imgW = imageToExtractPNG.width, imgH = imageToExtractPNG.height;
        let offsetX = 0, offsetY = 0;

        if (imgmeta.atlassed && imgmeta.texcoords) {
            // imgmeta.texcoords has 12 floats: 6 vertices in clip space (x,y).
            const coords = imgmeta.texcoords as number[];
            const xs = [coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]];
            const ys = [coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]];

            const minX = Math.min(...xs), maxX = Math.max(...xs);
            const minY = Math.min(...ys), maxY = Math.max(...ys);

            // Then compute your region for ASCII art:
            offsetX = Math.floor(minX * imageToExtractPNG.width);
            offsetY = Math.floor(minY * imageToExtractPNG.height);
            imgW = Math.floor((maxX - minX) * imageToExtractPNG.width);
            imgH = Math.floor((maxY - minY) * imageToExtractPNG.height);
        }

        if (imgW <= 0 || imgH <= 0) return { subimage: null, width: 0, height: 0 };

        // Extract the subimage from the atlas
        const subimageData = new Uint8Array(imgW * imgH * 4); // RGBA
        for (let y = 0; y < imgH; y++) {
            for (let x = 0; x < imgW; x++) {
                const srcIndex = ((offsetY + y) * imageToExtractPNG.width + (offsetX + x)) * 4;
                const destIndex = (y * imgW + x) * 4;
                subimageData.set(imageToExtractPNG.data.subarray(srcIndex, srcIndex + 4), destIndex);
            }
        }

        return { subimage: Buffer.from(subimageData), width: imgW, height: imgH };
    } catch (e) {
        console.error('Error extracting subimage:', e);
        return { subimage: null, width: 0, height: 0 };
    }
}

function generateAsciiArtFromImageInAtlas(atlasBuf: Buffer, imgmeta: ImgMeta, modalWidth: number): string {
    const { subimage, width, height } = extractSubimageAndSizeFromAtlassedImage(atlasBuf, imgmeta);
    if (!subimage) return '[Unable to extract subimage]';

    // If the image is too large, we will not render it pixel-perfect
    if (width <= PER_PIXEL_RENDERING_THRESHOLD && height <= PER_PIXEL_RENDERING_THRESHOLD) {
        return generatePixelPerfectAsciiArt(subimage, width, height);
    }

    return generateBrailleAsciiArt(subimage, width, height, modalWidth);
}
