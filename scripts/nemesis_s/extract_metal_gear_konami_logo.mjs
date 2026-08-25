#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const workspaceRoot = process.cwd();
const sourceRoot = process.argv[2];
if (!sourceRoot) {
	throw new Error('Usage: extract_metal_gear_konami_logo.mjs <MetalGear source root> [output PNG]');
}
const outputPath = process.argv[3] || path.join(
	workspaceRoot,
	'carts/nemesis_s/res/img/intro_konami@atlas=intro.png',
);

const tileSources = [
	{ label: 'gfxKonamiLogo', nextLabel: 'gfxKonamiLogo2', color: 1, tileCount: 13 },
	{ label: 'gfxKonamiLogo2', nextLabel: 'gfxKonami', color: 2, tileCount: 13 },
	{ label: 'gfxKonami', color: 3, tileCount: 26 },
];
const palette = [
	[255, 255, 255],
	[255, 109, 0],
	[219, 36, 0],
	[146, 146, 146],
];
const logoX = 40;
const logoY = 64;
const logoWidth = 168;
const logoHeight = 48;

function parseAsmByte(token) {
	let source = token.trim();
	let sign = 1;
	if (source[0] === '-') {
		sign = -1;
		source = source.slice(1);
	}
	const value = source.endsWith('h')
		? Number.parseInt(source.slice(0, -1), 16)
		: Number.parseInt(source, 10);
	return (sign * value) & 0xff;
}

function readLabelBytes(source, label, nextLabel) {
	const startPattern = new RegExp(`^\\s*${label}:\\s*(.*)$`, 'm');
	const start = startPattern.exec(source);
	if (!start) {
		throw new Error(`Missing assembly label ${label}`);
	}
	let body = `${start[1]}\n${source.slice(start.index + start[0].length)}`;
	if (nextLabel) {
		const end = new RegExp(`^\\s*${nextLabel}:`, 'm').exec(body);
		body = body.slice(0, end.index);
	} else {
		const end = /^\S[^:;\r\n]*:/m.exec(body);
		if (end) {
			body = body.slice(0, end.index);
		}
	}
	const bytes = [];
	for (const line of body.split(/\r?\n/)) {
		const declaration = /\bdb\s+(.+)/i.exec(line.split(';', 1)[0]);
		if (declaration) {
			for (const token of declaration[1].split(',')) {
				bytes.push(parseAsmByte(token));
			}
		}
	}
	return bytes;
}

const graphicsSource = fs.readFileSync(
	path.join(sourceRoot, 'gfx/konamilogo.asm'),
	'latin1',
);
const logicSource = fs.readFileSync(
	path.join(sourceRoot, 'logic/konamilogo.asm'),
	'latin1',
);

const tiles = [null];
for (const source of tileSources) {
	const bytes = readLabelBytes(graphicsSource, source.label, source.nextLabel);
	if (bytes.length !== source.tileCount * 8) {
		throw new Error(`${source.label} contains ${bytes.length} bytes`);
	}
	for (let offset = 0; offset < bytes.length; offset += 8) {
		const tile = new Uint8Array(64);
		for (let y = 0; y < 8; y += 1) {
			const bits = bytes[offset + y];
			for (let x = 0; x < 8; x += 1) {
				if ((bits & (0x80 >> x)) !== 0) {
					tile[y * 8 + x] = source.color;
				}
			}
		}
		tiles.push(tile);
	}
}

const page = new Uint8Array(256 * 128);
const layout = readLabelBytes(logicSource, 'KonamiLogoTiles');
let rowX = 64;
let x = rowX;
let y = logoY;
let layoutIndex = 0;
while (layout[layoutIndex] !== 0xff) {
	const tileIndex = layout[layoutIndex];
	layoutIndex += 1;
	if (tileIndex === 0xfe) {
		const encodedOffset = layout[layoutIndex];
		layoutIndex += 1;
		rowX += encodedOffset < 0x80 ? encodedOffset : encodedOffset - 0x100;
		x = rowX;
		y += 8;
		continue;
	}
	const tile = tiles[tileIndex];
	for (let tileY = 0; tileY < 8; tileY += 1) {
		for (let tileX = 0; tileX < 8; tileX += 1) {
			page[(y + tileY) * 256 + x + tileX] = tile[tileY * 8 + tileX];
		}
	}
	x += 8;
}

const png = new PNG({ width: logoWidth, height: logoHeight });
for (let outputY = 0; outputY < logoHeight; outputY += 1) {
	for (let outputX = 0; outputX < logoWidth; outputX += 1) {
		const color = palette[page[(logoY + outputY) * 256 + logoX + outputX]];
		const outputOffset = (outputY * logoWidth + outputX) * 4;
		png.data[outputOffset] = color[0];
		png.data[outputOffset + 1] = color[1];
		png.data[outputOffset + 2] = color[2];
		png.data[outputOffset + 3] = 0xff;
	}
}
fs.writeFileSync(outputPath, PNG.sync.write(png));
console.log(`wrote ${outputPath}`);
