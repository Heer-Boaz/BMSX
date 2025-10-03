#!/usr/bin/env node
// ROM Pack Inspector CLI
// Usage: npx tsx scripts/rominspector.ts <romfile>

import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import * as fs from 'fs/promises';
import * as pako from 'pako';
import { PNG } from 'pngjs';
import type { asset_type, AudioMeta, GLTFModel, ImgMeta, RomAsset, RomMeta } from '../../src/bmsx/rompack/rompack';
import { decodeBinary } from '../../src/bmsx/serializer/binencoder';
import { loadModelFromBuffer as loadGLTFModelFromBuffer } from '../bootrom/bootresources';
import { getZippedRomAndRomLabelFromBlob, loadAssetList, parseMetaFromBuffer } from '../bootrom/bootrom';
import { generateAtlasName } from '../rompacker/atlasbuilder';
import { asciiWaveBraille, generateBrailleAsciiArt, generatePixelPerfectAsciiArt, parseWav, renderBufferBar, renderSummaryBar } from './asciiart';

const PER_PIXEL_RENDERING_THRESHOLD = 64; // sprites ≤64×64 get per-pixel rendering

let modal: blessed.Widgets.BoxElement | null = null;
let filteredAssetList: RomAsset[] = [];
let assetList: RomAsset[] = [];

function formatNumber(n: number): string {
	const units = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
	let i = 0;
	let num = n;
	while (num >= 1000 && i < units.length - 1) {
		num /= 1000;
		i++;
	}
	return i === 0 ? `${n}` : `${num.toFixed(2)}${units[i]}`;
}

function formatByteSize(size: number): string {
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
	let copyBuffer = new ArrayBuffer(buf.byteLength);
	copyBuffer = buf.slice(0);

	// Use TextDecoder to decode the ArrayBuffer directly
	const decoded = decodeuint8arr(new Uint8Array(copyBuffer));

	return decoded;
}

async function loadDataFromBuffer(buf: ArrayBuffer): Promise<any> {
	if (!(buf instanceof ArrayBuffer)) {
		console.error('loadDataFromBuffer expects an ArrayBuffer, got:', buf);
		throw new Error('Invalid buffer type, expected ArrayBuffer, please check the ROM file.');
	}
	if (buf.byteLength === 0) {
		throw new Error(`loadDataFromBuffer received an empty buffer, please check the ROM file.`);
	}
	// First create a copy of the ArrayBuffer to avoid issues with shared memory
	let copyBuffer = new ArrayBuffer(buf.byteLength);
	copyBuffer = buf.slice(0);

	// Use decodeBinary to parse the binary data
	try {
		return decodeBinary(new Uint8Array(copyBuffer));
	} catch (e) {
		throw new Error(`Failed to parse data from buffer: ${e}`);
	}
}

async function loadAssets(rombin: Buffer | ArrayBuffer) {
	let assets: RomAsset[] = [];
	try {
		const arrayBuffer = rombin instanceof ArrayBuffer ? rombin : rombin.buffer.slice(rombin.byteOffset, rombin.byteOffset + rombin.byteLength);
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
		// @ts-ignore
		assets = await loadAssetList(rombin);

		console.log('ROM pack metadata and resources loaded successfully.');

		console.log(`Extracted ${assets.length} assets from ROM pack.`);
	} catch (e: any) {
		console.error(`Failed to decode metadata: ${e.message}`);
		console.error(e?.stack ?? 'No stack trace available');
		process.exit(1);
	}
	return assets;
}

function generateOverlayAscii(imgW: number, imgH: number, polys: number[][], modalWidth: number): string {
	const buf = Buffer.alloc(imgW * imgH * 4, 0);
	const put = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= imgW || y >= imgH) return;
		const i = ((y | 0) * imgW + (x | 0)) << 2;
		buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 0; buf[i + 3] = 255;
	};
	const line = (x0: number, y0: number, x1: number, y1: number) => {
		x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
		const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
		const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1; let err = dx + dy;
		for (; ;) {
			put(x0, y0);
			if (x0 === x1 && y0 === y1) break;
			const e2 = 2 * err;
			if (e2 >= dy) { err += dy; x0 += sx; }
			if (e2 <= dx) { err += dx; y0 += sy; }
		}
	};
	for (const p of polys || []) {
		const n = p.length;
		for (let i = 0; i < n; i += 2) {
			const j = (i + 2 === n) ? 0 : i + 2;
			line(p[i], p[i + 1], p[j], p[j + 1]);
		}
	}
	if (imgW <= PER_PIXEL_RENDERING_THRESHOLD && imgH <= PER_PIXEL_RENDERING_THRESHOLD) {
		return generatePixelPerfectAsciiArt(buf, imgW, imgH);
	}
	return generateBrailleAsciiArt(buf, imgW, imgH, modalWidth);
}

function getMetadataBuffer(rombin: Buffer | ArrayBuffer, rommeta: RomMeta) {
	const metadataOffset = rommeta.start;
	const metadataLength = rommeta.end - rommeta.start;
	// Validate metadataOffset and metadataLength
	if (
		!Number.isFinite(metadataOffset) ||
		!Number.isFinite(metadataLength) ||
		metadataOffset < 0 ||
		metadataLength < 0 ||
		metadataOffset + metadataLength > rombin.byteLength ||
		metadataOffset > rombin.byteLength - 16
	) {
		console.error(`Invalid metadata offset or length: offset=${metadataOffset} (${formatByteSize(metadataOffset)}), length=${metadataLength} (${formatByteSize(metadataLength)})`);
		process.exit(1);
	}

	const metaBuf = rombin.slice(metadataOffset, metadataOffset + metadataLength);
	if (!metaBuf || metaBuf.byteLength === 0) {
		console.error('No metadata found in ROM file, invalid ROM file.');
		process.exit(1);
	}
	if (metaBuf.byteLength !== metadataLength) {
		console.error(`Metadata length mismatch: expected ${metadataLength} bytes, got ${metaBuf.byteLength} bytes`);
		process.exit(1);
	}
	console.log(`Metadata buffer loaded: offset=${metadataOffset} (${formatByteSize(metadataOffset)}), length=${metadataLength} (${formatByteSize(metadataLength)})`);
	return { metaBuf, metadataOffset, metadataLength };
}

async function loadRompackFromFile(romfile: string): Promise<Buffer> {
	let raw: Buffer
	let error: any;
	let rawSize = 0;
	let deflatedSize = 0;
	try {
		console.log(`Reading ROM file from "${romfile}"...`);
		raw = await fs.readFile(romfile);
		rawSize = raw.byteLength;
		console.log(`Read ${formatByteSize(rawSize)} from ROM file.`);
	}
	catch (e: any) {
		error = e;
	}
	// Check whether the file exists
	if (!raw) {
		throw new Error(`Failed to read ROM file at "${romfile}": ${error?.message || 'Unknown error'}`);
	}

	const { zipped_rom, romlabel } = await getZippedRomAndRomLabelFromBlob(
		// @ts-ignore
		raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
	);
	if (!zipped_rom || zipped_rom.byteLength === 0) {
		throw new Error(`ROM file "${romfile}" is empty or invalid.`);
	}
	console.log(`Loaded ROM file "${romfile}" with label: ${romlabel || 'No label'}`);

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

	const zippedView = new Uint8Array(zipped_rom) as Uint8Array<ArrayBufferLike>;
	const isCompressed = isPakoCompressed(zippedView);
	let rombin = null;
	if (isCompressed) {
		console.log('ROM is compressed, decompressing...');
		let zipped = zippedView;
		let decompressed: Uint8Array;
		try {
			decompressed = pako.inflate(zipped);
		} catch (e: any) {
			const msg = e && typeof e.message === 'string' ? e.message : String(e);
			console.error(`Failed to decompress ROM: ${msg}`);
			console.error(e?.stack ?? 'No stack trace available');
			decompressed = null; // fallback to null if decompression fails
		}
		rombin = decompressed.buffer ?? raw; // Use decompressed data if available, otherwise fallback to raw
		deflatedSize = rombin.byteLength;
		console.log(`Decompressed ROM size: ${formatByteSize(deflatedSize)}`);
		console.log(`Compressed size vs uncompressed size (lower is better): ${((rawSize / deflatedSize) * 100).toFixed(2)}%`);
	} else {
		console.log('ROM is uncompressed, using as-is.');
		rombin = raw;
	}
	if (!rombin) {
		throw new Error('ROM pack is empty or invalid after decompression.');
	}
	return rombin as Buffer;
}

async function main() {
	const romfile = process.argv[2];
	if (!romfile) {
		console.error('Usage: npx tsx scripts/rominspector.ts <romfile>');
		process.exit(1);
	}

	// Load the ROM pack from the specified file
	let rombin: Buffer | ArrayBuffer;
	try {
		rombin = await loadRompackFromFile(romfile);
	} catch (e: any) {
		console.error(`Failed to load ROM file "${romfile}": ${e.message}`);
		console.error(e?.stack ?? 'No stack trace available');
		process.exit(1);
	}

	// @ts-ignore
	const rommeta = parseMetaFromBuffer(rombin);
	if (!rommeta || !rommeta.start || !rommeta.end) {
		console.error('Invalid ROM metadata, unable to parse ROM file.');
		process.exit(1);
	}
	console.log(`ROM metadata: start=${rommeta.start} (${formatByteSize(rommeta.start)}), end=${rommeta.end} (${formatByteSize(rommeta.end)}, length=${rommeta.end - rommeta.start} (${formatByteSize(rommeta.end - rommeta.start)}))`);

	const { metaBuf, metadataOffset, metadataLength } = getMetadataBuffer(rombin, rommeta);
	assetList = await loadAssets(rombin);

	const imageAssets = assetList.filter(a => a.type === 'image') ?? [];
	const audioCount = assetList.filter(a => a.type === 'audio')?.length ?? 0;
	const dataCount = assetList.filter(a => a.type === 'data')?.length ?? 0;
	const modelCount = assetList.filter(a => a.type === 'model')?.length ?? 0;
	const codeCount = assetList.filter(a => a.type === 'code')?.length ?? 0;
	const otherCount = assetList.filter(a => a.type !== 'image' && a.type !== 'audio' && a.type !== 'code' && a.type !== 'model')?.length ?? 0;

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
			if (typeof a.start === 'number' && typeof a.end === 'number') size += a.end - a.start;
			if (typeof a.metabuffer_start === 'number' && typeof a.metabuffer_end === 'number') size += a.metabuffer_end - a.metabuffer_start;
			return sum + size;
		}, 0);
		const audioSize = assetList.filter(a => a.type === 'audio').reduce((sum, a) => {
			let size = 0;
			if (typeof a.start === 'number' && typeof a.end === 'number') size += a.end - a.start;
			if (typeof a.metabuffer_start === 'number' && typeof a.metabuffer_end === 'number') size += a.metabuffer_end - a.metabuffer_start;
			return sum + size;
		}, 0);
		const atlasSize = assetList.filter(a => a.type === 'atlas').reduce((sum, a) => {
			let size = 0;
			if (typeof a.start === 'number' && typeof a.end === 'number') size += a.end - a.start;
			if (typeof a.metabuffer_start === 'number' && typeof a.metabuffer_end === 'number') size += a.metabuffer_end - a.metabuffer_start;
			return sum + size;
		}, 0);
		const dataSize = assetList.filter(a => a.type === 'data').reduce((sum, a) => {
			let size = 0;
			if (typeof a.start === 'number' && typeof a.end === 'number') size += a.end - a.start;
			if (typeof a.metabuffer_start === 'number' && typeof a.metabuffer_end === 'number') size += a.metabuffer_end - a.metabuffer_start;
			return sum + size;
		}, 0);
		const modelSize = assetList.filter(a => a.type === 'model').reduce((sum, a) => {
			let size = 0;
			if (typeof a.start === 'number' && typeof a.end === 'number') size += a.end - a.start;
			if (typeof a.metabuffer_start === 'number' && typeof a.metabuffer_end === 'number') size += a.metabuffer_end - a.metabuffer_start;
			return sum + size;
		}, 0);
		const codeSize = assetList.reduce((sum, a) => a.type === 'code' ? sum + (a.end - a.start) : sum, 0);
		const totalSize = rombin.byteLength;

		const barLength = getBarLength(typeof screen.width === 'number' ? screen.width : 120);

		// --- Compute regions for summary bar ---
		const summaryRegions: Array<{ start: number, end: number, colorTag: string, label: string }> = [];
		for (const asset of assetList) {
			let colorTag: string;
			const label: asset_type = asset.type;
			switch (asset.type) {
				case 'image':
					colorTag = '{light-yellow-fg}';
					break;
				case 'atlas':
					colorTag = '{light-cyan-fg}';
					break;
				case 'audio':
					colorTag = '{light-blue-fg}';
					break;
				case 'code':
					colorTag = '{light-white-fg}';
					break;
				case 'data':
					colorTag = '{light-green-fg}';
					break;
				case 'model':
					colorTag = '{light-magenta-fg}';
					break;
				default:
					colorTag = '{light-magenta-fg}'; // Default for other types
					break;
			}

			if (asset.start || asset.end || asset.metabuffer_start || asset.metabuffer_end) {
				const start = (asset.start == asset.end) ? asset.metabuffer_start ?? 0 : asset.start;
				const end = (asset.end == asset.start) ? asset.metabuffer_end ?? 0 : asset.end;
				summaryRegions.push({ start, end, colorTag, label });
			}
		}
		// Global metadata region
		summaryRegions.push({ start: metadataOffset, end: metadataOffset + metadataLength, colorTag: '{light-red-fg}', label: 'global metadata' });

		const imageSizePercent = (imagesSize / totalSize * 100).toFixed(1);
		const audioSizePercent = (audioSize / totalSize * 100).toFixed(1);
		const dataSizePercent = (dataSize / totalSize * 100).toFixed(1);
		const modelSizePercent = (modelSize / totalSize * 100).toFixed(1);
		const codeSizePercent = (codeSize / totalSize * 100).toFixed(1);
		const atlasSizePercent = (atlasSize / totalSize * 100).toFixed(1);
		const metaSizePercent = (metaBuf.byteLength / totalSize * 100).toFixed(1);

		return `Total assets: ${assetList?.length ?? 0} (images: ${imageAssets?.length ?? 0
			}, audio: ${audioCount}, data: ${dataCount}, models: ${modelCount}, code: ${codeCount}, other: ${otherCount}) \n` +
			`Buffer: ${renderSummaryBar(summaryRegions, totalSize, barLength)}\n` +
			`Total size: ${formatByteSize(totalSize)} | ` +
			`Images: ${formatByteSize(imagesSize)} (${imageSizePercent}%) | ` +
			`Audio: ${formatByteSize(audioSize)} (${audioSizePercent}%) | ` +
			`Data: ${formatByteSize(dataSize)} (${dataSizePercent}%) | ` +
			`Models: ${formatByteSize(modelSize)} (${modelSizePercent}%) | ` +
			`Code: ${formatByteSize(codeSize)} (${codeSizePercent}%) | ` +
			`Atlas: ${formatByteSize(atlasSize)} (${atlasSizePercent}%) | ` +
			`Metadata: ${formatByteSize(metaBuf.byteLength)} (${metaSizePercent}%)`;
	}

	const summaryBox = blessed.box({
		top: 0,
		left: 'center',
		width: '100%',
		height: 5,
		tags: true,
		style: { fg: 'green', bg: 'black' },
		content: generateSummaryContent()
	});

	const table = contrib.table({
		top: 5,
		left: 'center',
		width: '100%',
		height: '100%-5',
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
	}) as contrib.Widgets.TableElement & { rows: blessed.Widgets.ListElement & { selected: number } };

	updateTable();

	screen.append(summaryBox);
	screen.append(table);
	table.focus();
	screen.render();

	// Add custom key handlers for pageup / pagedown / home / end
	const tableRowsList = table.rows;
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
			asset.resid ? String(asset.resid) : '',
			asset.resid ? String(asset.resid) : '',
			asset.type ? String(asset.type) : '',
			(() => {
				let size = 0;
				if (asset.start != null && asset.end != null) size += asset.end - asset.start;
				if (asset.metabuffer_start != null && asset.metabuffer_end != null) size += asset.metabuffer_end - asset.metabuffer_start;
				return formatByteSize(size); // Convert size to human-readable format
			})()
		]);
		table.setData({
			headers: ['Name', 'ID', 'Type', 'Size'],
			data: tableRows,
		});

		screen.render();
	}

	// Use table.rows for selection events (works for both mouse and keyboard)
	table.rows.on('select', async (_item, idx) => {
		await showAssetModal(idx);
	});

	// Helper to show asset modal by index
	async function showAssetModal(idx: number, tabIndex?: number) {
		let selected = filteredAssetList[idx] as RomAsset;
		const imgmeta = selected.imgmeta || {} as ImgMeta;
		const audiometa = selected.audiometa || {} as AudioMeta;
		let bufferSize = selected.end - selected.start;
		let asciiArt = '';
		const metadataLines: string[] = [];

		if (modal) {
			modal.destroy();
			modal = null;
		}
		modal = blessed.box({
			parent: screen,
			top: 'center', left: 'center',
			width: '80%', height: '80%',
			border: 'line', style: { border: { fg: 'yellow' }, bg: 'black' },
			label: `Asset - Name: ${selected.resid} | ID: ${selected.resid} | Type: ${selected.type}`,
			tags: true, scrollable: false, alwaysScroll: false, keys: true, mouse: true, draggable: true,
			vi: true, input: true, // Enable vi-style keybindings
			// scrollbar: { ch: '|', track: { bg: 'grey' }, style: { bg: 'yellow' } }
		});

		// If modal.height is a string like '80%', parse it to a number
		const heightNum = typeof modal.height === 'string'
			? Math.floor((parseInt(modal.height) / 100) * (screen.height as number))
			: (modal.height as number);

		const getModalWidth = () => (modal?.width ?? 80) as number;

		// Show image/audio specific metadata
		switch (selected.type) {
			case 'image':
				if (imgmeta.atlassed && imgmeta.texcoords) {
					const atlasName = generateAtlasName(imgmeta.atlasid ?? 0);
					const atlasAsset = assetList.find(a => a.resid === atlasName && a.type === 'atlas');
					if (atlasAsset) {
						const atlasBuf = atlasAsset.buffer instanceof Uint8Array
							? Buffer.from(atlasAsset.buffer)
							// @ts-ignore
							: Buffer.from(rombin.slice(atlasAsset.start, atlasAsset.end));

						try {
							asciiArt = generateAsciiArtFromImageInAtlas(atlasBuf, imgmeta, getModalWidth());
						} catch (e: any) {
							asciiArt = `Failed to decode atlas PNG: ${e.message}\n`;
						}
					} else {
						asciiArt = '[Atlas asset not found]';
					}
					if (imgmeta.width) metadataLines.push(`Size: ${imgmeta.width}x${imgmeta.height} `);
					if (imgmeta.hitpolygons?.original && imgmeta.width && imgmeta.height) {
						asciiArt += `\n{yellow-fg}HitPolygons (convex pieces) overlay:{/yellow-fg}\n`;
						asciiArt += generateOverlayAscii(imgmeta.width, imgmeta.height, imgmeta.hitpolygons.original, getModalWidth());
					}
					for (const [key, value] of Object.entries(imgmeta)) {
						metadataLines.push(`${key}: ${JSON.stringify(value)}`);
					}
				} else {
					asciiArt = generateAsciiArtFromImageBuffer(selected.buffer, getModalWidth());
					if (imgmeta.hitpolygons?.original && imgmeta.width && imgmeta.height) {
						asciiArt += `\n{yellow-fg}HitPolygons (convex pieces) overlay:{/yellow-fg}\n`;
						asciiArt += generateOverlayAscii(imgmeta.width, imgmeta.height, imgmeta.hitpolygons.original, getModalWidth());
					}
				}
				break;
			case 'atlas': {
				for (const [key, value] of Object.entries(imgmeta)) {
					metadataLines.push(`${key}: ${JSON.stringify(value)}`);
				}
				const bufferData = selected.buffer instanceof Uint8Array
					? Buffer.from(selected.buffer)
					// @ts-ignore
					: Buffer.from(rombin.slice(selected.start, selected.end));
				asciiArt = generateAsciiArtFromImageBuffer(bufferData, getModalWidth());
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
					asciiArt = '[No audio buffer available]';
					// @ts-ignore
					if (!selected.buffer || !(selected.buffer instanceof ArrayBuffer) || selected.buffer?.byteLength === 0) {
						// Load the audio buffer from the ROM pack
						// @ts-ignore
						(selected.buffer as ArrayBuffer) = await loadAudio(rombin.slice(selected.start, selected.end));
					}
					// @ts-ignore
					const info = parseWav(selected.buffer as Uint8Array);
					if (!info || !info.dataOff || !info.dataLen || !info.bits || !info.channels) {
						asciiArt = '[Invalid WAV data]';
						break;
					}
					else asciiArt = `${info.dataOff} ${info.dataLen} ${info.bits} ${info.channels}`;
					const pcm = new Uint8Array(selected.buffer).subarray(info.dataOff, info.dataOff + info.dataLen);

					const scope = asciiWaveBraille(
						pcm, info.bits, getModalWidth() - 10, undefined, info.channels,
					);
					asciiArt = scope;
				} catch (e) {
					asciiArt = `(Preview failed: ${e}\n${e.stack})`;
				}
				break;
			case 'data':
				if (!selected.buffer || typeof selected.buffer !== 'object') {
					// @ts-ignore
					selected.buffer = await loadDataFromBuffer(rombin.slice(selected.start, selected.end));
				}
				metadataLines.push(`Data size: ${formatByteSize(selected.end - selected.start)}`);
				asciiArt = JSON.stringify(selected.buffer, null, 2);
				break;
			case 'model':
				if (!selected.buffer || typeof (selected.buffer as any).meshes === 'undefined') {
					const texBuf = (selected as any).texture_start != null && (selected as any).texture_end != null
						? rombin.slice((selected as any).texture_start, (selected as any).texture_end)
						: undefined;
					// @ts-ignore
					selected.buffer = await loadGLTFModelFromBuffer(String(selected.resid), rombin.slice(selected.start, selected.end), texBuf);
				}
				metadataLines.push(`Model size: ${formatByteSize(selected.end - selected.start)}`);
				metadataLines.push(`Model content: ${JSON.stringify(selected.buffer, null)}`);

				// Validate that selected.buffer is actually a GLTFModel at runtime.
				// If not, try to reparsed the raw bytes (if available) or throw a clear error.
				{
					const bufCandidate = selected.buffer;
					if (!isGLTFModel(bufCandidate)) {
						// If the buffer looks like raw bytes, attempt to parse again explicitly
						if (isBinaryBuffer(bufCandidate)) {
							try {
								const texBuf = (selected as any).texture_start != null && (selected as any).texture_end != null
									? rombin.slice((selected as any).texture_start, (selected as any).texture_end)
									: undefined;
								// Re-parse using the loader to obtain a GLTFModel
								// @ts-ignore
								selected.buffer = await loadGLTFModelFromBuffer(String(selected.resid), rombin.slice(selected.start, selected.end), texBuf);
							} catch (e: any) {
								throw new Error(`Failed to parse GLTF model for '${selected.resid}': ${e?.message ?? String(e)}`);
							}
							// reassign candidate after parsing
							if (!isGLTFModel(selected.buffer)) {
								throw new Error(`Asset '${selected.resid}' was parsed but is not a GLTFModel.`);
							}
						} else {
							throw new Error(`Asset '${selected.resid}' buffer is not a GLTFModel (got ${typeof bufCandidate}).`);
						}
					}
				}

				// At this point selected.buffer is validated to be a GLTFModel
				// Use a local snapshot of the buffer so TypeScript can narrow its type
				const bufCandidateAfterParse = selected.buffer;
				if (!isGLTFModel(bufCandidateAfterParse)) {
					// This should not happen because we validated/parsed above, but fail loudly if it does.
					throw new Error(`Asset '${selected.resid}' buffer is not a GLTFModel after parsing (got ${typeof bufCandidateAfterParse}).`);
				}
				const modelData: GLTFModel = bufCandidateAfterParse;

				metadataLines.push(`Nodes: ${modelData.nodes ? modelData.nodes.length : 0}`);
				metadataLines.push(`Scenes: ${modelData.scenes ? modelData.scenes.length : 0}`);
				metadataLines.push(`Skins: ${modelData.skins ? modelData.skins.length : 0}`);
				const first = modelData.meshes[0];
				if (first) {
					metadataLines.push(`MorphTargets: ${first.morphPositions ? first.morphPositions.length : 0}`);
					metadataLines.push(`Joints: ${first.jointIndices ? first.jointIndices.length / 4 : 0}`);
					asciiArt =
						`Meshes: ${modelData.meshes.length}\n` +
						`Vertices: ${first.positions.length / 3}\n` +
						`UVs: ${first.texcoords ? first.texcoords.length / 2 : 0}\n` +
						`Normals: ${first.normals ? first.normals.length / 3 : 0}\n` +
						`Indices: ${first.indices ? first.indices.length : 0}\n` +
						`MaterialIndex: ${first.materialIndex ? first.materialIndex : 'None'}\n` +
						`Images: ${modelData.imageBuffers ? modelData.imageBuffers.length : 0}\n` +
						`\tImageOffsets: ${modelData.imageOffsets ? modelData.imageOffsets.length : 0}\n` +
						modelData.imageOffsets?.map((callbackfn, i) => `\t\t${i}: ${callbackfn.start} - ${callbackfn.end} (${formatByteSize(callbackfn.end - callbackfn.start)})`).join('\n') + '\n' +
						`MorphTargets: ${first.morphPositions ? first.morphPositions.length : 0}\n` +
						`Joints: ${first.jointIndices ? first.jointIndices.length / 4 : 0}\n` +
						`Animations: ${modelData.animations ? modelData.animations.length : 0}\n` +
						modelData.animations?.map((anim, i) => `\t${i}: ${anim.name ?? 'Unnamed'}, ${anim.channels.length} channel(s), ${anim.samplers.length} sampler(s)`).join('\n') + '\n' +
						`Scenes: ${modelData.scenes ? modelData.scenes.length : 0}\n` +
						`Default scene: ${modelData.scene ?? 0}\n`;
					if (modelData.imageBuffers) {
						for (let i = 0; i < modelData.imageBuffers.length; i++) {
							const imgBuf = Buffer.from(modelData.imageBuffers[i]);
							asciiArt += `\nImage ${i + 1} (${formatByteSize(imgBuf.byteLength)}):\n`;
							asciiArt += generateAsciiArtFromImageBuffer(imgBuf, getModalWidth());
						}
					}
					let materialIndex = 0;
					for (const material of (modelData.materials && modelData.materials.length > 0 ? modelData.materials : [])) {
						asciiArt += `\nMaterial ${materialIndex}: ${JSON.stringify(material, null, 2)}\n`;
						const textureIndex = material.baseColorTexture;
						if (textureIndex !== undefined && textureIndex !== null && modelData.imageBuffers) {
							if (modelData.imageBuffers[textureIndex]) {
								const imgBuf = Buffer.from(modelData.imageBuffers[textureIndex]);
								asciiArt += `Texture ${textureIndex} (${formatByteSize(imgBuf.byteLength)}):\n`;
								asciiArt += generateAsciiArtFromImageBuffer(imgBuf, getModalWidth());
							}
							else {
								asciiArt += `{red-fg}Index ${textureIndex} (for baseColorTexture) not found in model images{/red-fg}!\n`;
							}
						}
						else {
							asciiArt += `No texture for material ${materialIndex}\n`;
						}
						materialIndex++;
					}
				} else {
					asciiArt = 'No mesh data';
				}
				break;
			case 'code': {
				let code = '';
				// Load the code buffer from the ROM pack
				// @ts-ignore
				code = await loadSourceFromBuffer(rombin.slice(selected.start, selected.end));
				const sourceMapUrlIndex = code.indexOf('sourceMappingURL=');
				metadataLines.push(`Characters in code: ${formatNumber(code.length - (sourceMapUrlIndex !== -1 ? code.length - sourceMapUrlIndex : 0))}`);
				metadataLines.push(`Sourcemap: ${sourceMapUrlIndex !== -1 ? 'Yes' : 'No'}`);

				if (!code || code.length === 0) {
					code = '[No code buffer available]';
				} else {
					// Show the first 1000 characters of the code
					code = code.slice(0, 1000);
					if (code.length >= 1000) {
						code += ' ... (truncated)';
					}
				}
				asciiArt = `{gray-fg}###########################################\n${code}\n###########################################{/gray-fg}`;
			}
				break;
		}

		// Show generic metadata details
		const bufferLines = [];
		const metabufferSize = selected.metabuffer_end - selected.metabuffer_start;
		if (bufferSize || metabufferSize) {
			const barLength = getBarLength(modal?.width as number);
			const total = rombin.byteLength;
			const regions = [];
			const bufferRegionColor = '{light-red-fg}';
			const metabufferRegionColor = '{light-blue-fg}';
			if (selected.start !== undefined && selected.end !== undefined) {
				regions.push({ start: selected.start, end: selected.end, colorTag: bufferRegionColor, label: 'buffer' });
			}
			if (selected.metabuffer_start !== undefined && selected.metabuffer_end !== undefined) {
				regions.push({ start: selected.metabuffer_start, end: selected.metabuffer_end, colorTag: metabufferRegionColor, label: 'metabuffer' });
			}
			const bar = renderBufferBar(regions, total, barLength);
			bufferLines.push(`Buffer: ${bar} `);
			if (bufferSize) bufferLines.push(`Buffer: ${selected.start} - ${selected.end} (${formatByteSize(bufferSize)})`);
			// Metabuffer region info
			if (metabufferSize) bufferLines.push(`Metabuffer: ${selected.metabuffer_start} - ${selected.metabuffer_end} (${formatByteSize(metabufferSize)})`);
			if (bufferSize && metabufferSize) {
				const totalSize = (bufferSize ?? 0) + (metabufferSize ?? 0);
				bufferLines.push(`Total size: ${formatByteSize(totalSize)} `);
			}
		}

		// metadataLines.push('\n', additionalMetadataLines.join('\n'), '\n');
		let currentTab = tabIndex || 0; // Default to 0 if not provided
		const tabLabels = ['Preview', 'Details', 'Hex', '×']; // Voeg sluit-tab toe

		// Maak een aparte box voor de tabbar
		const tabbarBox = blessed.box({
			parent: modal,
			top: 0,
			left: 0,
			width: '100%-2',
			height: 6,
			tags: true,
			style: { fg: 'white', bg: 'black' },
			content: '', // wordt gezet door renderTabBar()
			scrollable: false
		});

		const contentBox = blessed.box({
			parent: modal,
			top: 6,
			left: 0,
			width: '100%-2',
			height: '100%-8',
			tags: true,
			scrollable: true,
			alwaysScroll: true,
			keys: true,
			mouse: true,
			scrollbar: { ch: '|', track: { bg: 'grey' }, style: { bg: 'yellow' } }
		});

		// Voeg deze variabele toe boven renderTabBar:
		let tabBoxes: blessed.Widgets.BoxElement[] = [];

		function renderTabBar() {
			// Verwijder oude tabBoxes als ze bestaan
			if (tabBoxes.length) {
				tabBoxes.forEach(tb => tb.destroy());
				tabBoxes = [];
			}

			let x = 0;
			tabLabels.forEach((label, i) => {
				const tabText = ` ${label}   `;
				const isCloseTab = i === tabLabels.length - 1;
				const tabBox = blessed.box({
					parent: tabbarBox,
					top: 0,
					left: x,
					// left: !isCloseTab ? x : undefined,
					// right: isCloseTab ? 0 : undefined,
					width: tabText.length,
					height: 3,
					align: isCloseTab ? 'right' : 'center',
					focusable: false,
					tags: true,
					// @ts-ignore
					border: { type: 'line', fg: isCloseTab ? 'red' : (i === currentTab ? 'yellow' : 'blue') },
					mouse: true,
					content: `${tabText}`,
					style: {
						bg: isCloseTab ? 'red' : (i === currentTab ? 'yellow' : 'black'),
						fg: isCloseTab ? 'white' : (i === currentTab ? 'black' : 'white'),
						hover: isCloseTab ? { bg: 'magenta' } : { bg: 'blue' }
					}
				});
				if (isCloseTab) {
					tabBox.on('click', () => {
						if (modal) {
							modal.destroy();
							modal = null;
							table.focus();
							screen.render();
						}
					});
				} else {
					tabBox.on('click', () => {
						currentTab = i;
						renderModalContent();
					});
				}
				tabBoxes.push(tabBox);
				x += tabText.length;
			});

			let helpLine = '{white-fg}[←/→] Tab | [q] Quit{/white-fg}';
			let bufferInfo = `${bufferLines.join('\n')}\n`;
			tabbarBox.setContent(`\n${helpLine}\n\n${bufferInfo}`);
		}

		function renderModalContent(asset: RomAsset = selected) {
			let content = '';
			if (currentTab === 0) {
				content += `${asciiArt} \n`;
			} else if (currentTab === 1) {
				content += `${metadataLines.join('\n')}`;
			} else if (currentTab === 2) {
				// Asset buffer dump
				const assetBuf = asset.start || asset.end
					? new Uint8Array(rombin.slice(asset.start, asset.end))
					: null;
				if (!assetBuf || assetBuf.byteLength === 0) {
					content += `Buffer: [No buffer data available]\n`;
				} else {
					content += `Buffer: [${asset.start} - ${asset.end}]:\n${asciiHexDump(assetBuf)}\n`;
				}

				// Metabuffer dump (indien aanwezig)
				if (typeof asset.metabuffer_start === 'number' && typeof asset.metabuffer_end === 'number' && asset.metabuffer_end > asset.metabuffer_start) {
					const metaBuf = asset.metabuffer_start || asset.metabuffer_end
						? new Uint8Array(rombin.slice(asset.metabuffer_start, asset.metabuffer_end))
						: null;
					if (!metaBuf || metaBuf.byteLength === 0) {
						content += `Metabuffer: [No metabuffer data available]\n`;
					} else {
						content += `Metabuffer: [${asset.metabuffer_start} - ${asset.metabuffer_end}]\n${asciiHexDump(metaBuf)}\n`;
					}
				}
			}
			contentBox.setContent(content);
			renderTabBar();
			modal.screen.render();
		}

		renderModalContent();
		contentBox.focus();

		let currentIdx = table.rows.selected;
		// Navigatie en tab-wissel
		contentBox.key(['left', 'right', '1', '2', '3', 'pageup', 'pagedown', 'home', 'end', 'S-down', 'S-up', 'escape', 'enter'], (ch, key) => {
			if (!modal) return
			const keyname = key.name || ch;
			const shift = key.shift || keyname.startsWith('S-');
			// const ctrl = key.ctrl || keyname.startsWith('C-');
			// const alt = key.meta || keyname.startsWith('A-');

			switch (keyname) {
				case 'up':
					if (shift) {
						if (currentIdx <= 0) break; // Prevent going out of bounds
						currentIdx--;
						table.rows.select(currentIdx); // update table selection
						selected = filteredAssetList[currentIdx];
						showAssetModal(currentIdx, currentTab);
					}
					break;
				case 'down':
					if (shift) {
						if (currentIdx >= assetList.length - 1) break; // Prevent going out of bounds
						currentIdx++;
						table.rows.select(currentIdx); // update table selection
						selected = filteredAssetList[currentIdx];
						showAssetModal(currentIdx, currentTab);
					}
					break;
				case 'left':
					if (currentTab > 0) {
						currentTab--;
						renderModalContent();
					}
					break;
				case 'right':
					if (currentTab < tabLabels.length - 1) {
						currentTab++;
						if (currentTab === tabLabels.length - 1) currentTab--; // skip sluit-tab
						renderModalContent();
					}
					break;
				case '1':
					currentTab = 0;
					renderModalContent();
					break;
				case '2':
					currentTab = 1;
					renderModalContent();
					break;
				case '3':
					currentTab = 2;
					renderModalContent();
					break;
				case 'pageup':
					contentBox.scroll(-heightNum + 2);
					modal.screen.render();
					break;
				case 'pagedown':
					contentBox.scroll(heightNum - 2);
					modal.screen.render();
					break;
				case 'home':
					contentBox.scroll(-contentBox.getScrollHeight());
					modal.screen.render();
					break;
				case 'end':
					contentBox.scroll(contentBox.getScrollHeight());
					modal.screen.render();
					break;
				case 'escape':
				case 'enter':
					// if (ignoreFirstKeypress) {
					//     ignoreFirstKeypress = false;
					//     return;
					// }
					contentBox.removeAllListeners('keypress');
					contentBox.removeAllListeners('key');
					if (modal) {
						modal.destroy();
						modal = null;
						table.focus();
						screen.render();
					}
					break;
			}
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
		summaryBox.setContent(generateSummaryContent());
		screen.render();
	});

	screen.key(['q', 'C-c'], () => process.exit(0));
	screen.render();
}

main();

function extractSubimageAndSizeFromAtlassedImage(imgToExtract: Buffer, imgmeta: ImgMeta): { subimage: Buffer | null, width: number, height: number } {
	const atlas = PNG.sync.read(imgToExtract);
	if (!atlas || !atlas.data) throw new Error('Invalid atlas PNG data');

	// Default to full atlas
	let imgW = atlas.width, imgH = atlas.height;
	let offsetX = 0, offsetY = 0;

	if (imgmeta.atlassed) {
		if (!imgmeta.texcoords || !(Array.isArray(imgmeta.texcoords))) {
			throw new Error('Atlassed image missing texcoords');
		}
		// texcoords are pairs [x0,y0,x1,y1,...] in clip space (0..1)
		const coords = Array.from(imgmeta.texcoords as number[]);
		const xs: number[] = [];
		const ys: number[] = [];
		for (let i = 0; i + 1 < coords.length; i += 2) {
			xs.push(coords[i]);
			ys.push(coords[i + 1]);
		}
		if (xs.length === 0 || ys.length === 0) throw new Error('Invalid texcoords');

		const minU = Math.max(0, Math.min(...xs));
		const maxU = Math.min(1, Math.max(...xs));
		const minV = Math.max(0, Math.min(...ys));
		const maxV = Math.min(1, Math.max(...ys));

		// Convert to pixel coordinates and clamp inside atlas bounds
		offsetX = Math.floor(minU * atlas.width);
		offsetY = Math.floor(minV * atlas.height);
		imgW = Math.max(1, Math.min(atlas.width - offsetX, Math.round((maxU - minU) * atlas.width)));
		imgH = Math.max(1, Math.min(atlas.height - offsetY, Math.round((maxV - minV) * atlas.height)));
	}

	if (imgW <= 0 || imgH <= 0) throw new Error('Invalid subimage dimensions');

	// Extract the subimage from the atlas safely (RGBA)
	const subimageData = new Uint8Array(imgW * imgH * 4); // RGBA
	const atlasW = atlas.width;
	const atlasData = atlas.data as Uint8Array;

	for (let y = 0; y < imgH; y++) {
		const srcRow = ((offsetY + y) * atlasW) << 2; // *4
		const destRow = (y * imgW) << 2;
		// Copy a full row using indexed assignments to avoid OOB set
		for (let x = 0; x < imgW; x++) {
			const srcIdx = srcRow + ((offsetX + x) << 2);
			const dstIdx = destRow + (x << 2);
			// Guard: if atlas data shorter than expected, fill transparent
			if (srcIdx + 3 < atlasData.length) {
				subimageData[dstIdx] = atlasData[srcIdx];
				subimageData[dstIdx + 1] = atlasData[srcIdx + 1];
				subimageData[dstIdx + 2] = atlasData[srcIdx + 2];
				subimageData[dstIdx + 3] = atlasData[srcIdx + 3];
			} else {
				subimageData[dstIdx] = 0;
				subimageData[dstIdx + 1] = 0;
				subimageData[dstIdx + 2] = 0;
				subimageData[dstIdx + 3] = 0;
			}
		}
	}

	return { subimage: Buffer.from(subimageData), width: imgW, height: imgH };
}

function generateAsciiArtFromImageInAtlas(atlasBuf: Buffer, imgmeta: ImgMeta, modalWidth: number): string {
	try {
		const { subimage, width, height } = extractSubimageAndSizeFromAtlassedImage(atlasBuf, imgmeta);
		if (!subimage) return '[Unable to extract subimage]';
		let sizeString = `Size: ${width}x${height}\n`;
		// If the image is too large, we will not render it pixel-perfect
		if (width <= PER_PIXEL_RENDERING_THRESHOLD && height <= PER_PIXEL_RENDERING_THRESHOLD) {
			return sizeString + generatePixelPerfectAsciiArt(subimage, width, height);
		}

		return generateBrailleAsciiArt(subimage, width, height, modalWidth);
	} catch (e) {
		return `[Error generating ASCII art from image: ${e.stack || e.message}]`;
	}
}

function generateAsciiArtFromImageBuffer(img: Buffer, modalWidth: number): string {
	try {
		let sizeString = '';
		const imagePNG = PNG.sync.read(img);
		sizeString += `Size: ${imagePNG.width}x${imagePNG.height}\n`;
		if (!imagePNG || !imagePNG.data) return '[Invalid image data]';

		if (imagePNG.width <= PER_PIXEL_RENDERING_THRESHOLD && imagePNG.height <= PER_PIXEL_RENDERING_THRESHOLD) {
			return sizeString + generatePixelPerfectAsciiArt(imagePNG.data, imagePNG.width, imagePNG.height);
		}

		// If the image is too large, we will not render it pixel-perfect
		return sizeString + generateBrailleAsciiArt(imagePNG.data, imagePNG.width, imagePNG.height, modalWidth);
	} catch (e) {
		return `[Error generating ASCII art from image: ${e.stack || e.message}]`;
	}
}

function asciiHexDump(buf: Uint8Array | ArrayBuffer, maxBytes?: number): string {
	if (!(buf instanceof Uint8Array)) buf = new Uint8Array(buf);
	const bytesPerLine = 16;
	let result = '';
	const length = Math.min(buf.byteLength, maxBytes || buf.byteLength);
	for (let i = 0; i < length; i += bytesPerLine) {
		const slice = (buf as Uint8Array).subarray(i, i + bytesPerLine);
		let line = i.toString(16).padStart(8, '0') + '  ';
		line += Array.from(slice)
			.map(b => b.toString(16).padStart(2, '0'))
			.join(' ')
			.padEnd(bytesPerLine * 3 - 1, ' ');
		line += '  ';
		// Kleurt control-chars rood in het ASCII-gedeelte
		line += Array.from(slice)
			.map(b =>
				(b < 32 || b === 127)
					? `{red-fg}.{/red-fg}` // Control-chars als rode punt
					: (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')
			)
			.join('');
		result += line + '\n';
	}
	if (maxBytes && buf.byteLength > maxBytes) {
		result += `... (truncated, showing first ${maxBytes} bytes of ${buf.byteLength})\n`;
		return result;
	}
	return result;
}

// Add a runtime type-guard for GLTFModel to avoid unsafe casts
function isGLTFModel(obj: unknown): obj is GLTFModel {
	if (!obj || typeof obj !== 'object') return false;
	const anyObj = obj as { meshes?: unknown };
	return Array.isArray(anyObj.meshes);
}

// New helper: robust binary buffer detector (Buffer | Uint8Array | ArrayBuffer)
function isBinaryBuffer(x: unknown): x is ArrayBuffer | Uint8Array | Buffer {
	if (!x) return false;
	// Node Buffer
	// Buffer should be available in Node environments used by this script
	// Use Buffer.isBuffer when present
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	if (typeof Buffer !== 'undefined' && typeof Buffer.isBuffer === 'function' && Buffer.isBuffer(x)) return true;
	if (x instanceof Uint8Array) return true;
	if (x instanceof ArrayBuffer) return true;
	return false;
}
