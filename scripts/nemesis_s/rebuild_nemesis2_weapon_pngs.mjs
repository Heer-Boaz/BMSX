#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const outputDir = path.join(process.cwd(), 'carts/nemesis_s/res/img');
const rom = fs.readFileSync(path.join(
	process.cwd(),
	'.external/nemesis2rom/extracted/Nemesis2[File-Hunter.com].rom',
));

// TMS9918A palette values used by the source machine. Transparency is an
// authored surface policy: sprite records select pen zero, while the Graphic 2
// laser tile retains every background and foreground pixel.
const tmsPalette = [
	[0, 0, 0],
	[0, 0, 0],
	[33, 200, 66],
	[94, 220, 120],
	[84, 85, 237],
	[125, 118, 252],
	[212, 82, 77],
	[66, 235, 245],
	[252, 85, 84],
	[255, 121, 120],
	[212, 193, 84],
	[230, 206, 128],
	[33, 176, 59],
	[201, 91, 186],
	[204, 204, 204],
	[255, 255, 255],
];

const statusDescriptionPalette = [
	[216, 216, 32],
	[32, 32, 247],
];
const romBankSize = 0x2000;
const statusDescriptionBankOffset = 14 * romBankSize;
const statusDescriptionPointerTableOffset = statusDescriptionBankOffset
	+ (0x9bd3 & (romBankSize - 1));

const writeIndexedPng = (name, width, height, indices, palette, transparentPen) => {
	const png = new PNG({ width, height });
	for (let pixel = 0; pixel < indices.length; pixel += 1) {
		const paletteIndex = indices[pixel];
		const color = palette[paletteIndex];
		const output = pixel * 4;
		png.data[output] = color[0];
		png.data[output + 1] = color[1];
		png.data[output + 2] = color[2];
		png.data[output + 3] = paletteIndex === transparentPen ? 0 : 255;
	}
	fs.writeFileSync(path.join(outputDir, name), PNG.sync.write(png));
};

const statusDescriptionIndices = (assetId) => {
	const recordAddress = rom.readUInt16LE(statusDescriptionPointerTableOffset + assetId * 2);
	const recordOffset = statusDescriptionBankOffset + (recordAddress & (romBankSize - 1));
	const indices = new Uint8Array(64 * 8);
	for (let tile = 0; tile < 8; tile += 1) {
		for (let sourceY = 0; sourceY < 6; sourceY += 1) {
			const pattern = rom[recordOffset + tile * 6 + sourceY];
			const output = (sourceY + 1) * 64 + tile * 8;
			for (let x = 0; x < 8; x += 1) {
				indices[output + x] = (pattern & (0x80 >> x)) !== 0 ? 0 : 1;
			}
		}
	}
	return indices;
};

const spriteIndices = (patterns, colorIndex) => {
	const width = patterns.length === 8 ? 8 : 16;
	const indices = new Uint8Array(width * (patterns.length === 8 ? 8 : 16));
	for (let y = 0; y < indices.length / width; y += 1) {
		const left = patterns[y];
		const right = width === 16 ? patterns[y + 16] : 0;
		for (let x = 0; x < width; x += 1) {
			const row = x < 8 ? left : right;
			indices[y * width + x] = (row & (0x80 >> (x & 7))) !== 0 ? colorIndex : 0;
		}
	}
	return indices;
};

const graphic2Indices = (patterns, colors) => {
	const indices = new Uint8Array(64);
	for (let y = 0; y < 8; y += 1) {
		const pattern = patterns[y];
		const color = colors[y];
		const foreground = color >> 4;
		const background = color & 0x0f;
		for (let x = 0; x < 8; x += 1) {
			indices[y * 8 + x] = (pattern & (0x80 >> x)) !== 0 ? foreground : background;
		}
	}
	return indices;
};

// Source pattern/color records captured from the Nemesis 2 VRAM after the
// level-three MISSILE and LASER paths at B0B4 and AD85 had been admitted.
writeIndexedPng('napalm_missile_falling.png', 8, 8, spriteIndices(
	[0x10, 0x08, 0x30, 0xa4, 0x4c, 0x1e, 0x07, 0x03],
	15,
), tmsPalette, 0);
writeIndexedPng('napalm_missile_flying.png', 8, 8, spriteIndices(
	[0xa0, 0x6e, 0xef, 0x6e, 0xa0, 0x00, 0x00, 0x00],
	15,
), tmsPalette, 0);
writeIndexedPng('napalm_blast_1.png', 16, 16, spriteIndices([
	0x80, 0x09, 0x00, 0x05, 0x35, 0xa1, 0x1a, 0x07,
	0xab, 0x35, 0x0b, 0x35, 0x14, 0x63, 0x00, 0x10,
	0x10, 0x80, 0x02, 0x00, 0x30, 0x52, 0xe0, 0xc0,
	0xc0, 0xe0, 0xd0, 0x8c, 0x28, 0x26, 0x00, 0x40,
], 15), tmsPalette, 0);
writeIndexedPng('napalm_blast_2.png', 16, 16, spriteIndices([
	0x00, 0x04, 0x04, 0x00, 0x18, 0x19, 0x01, 0x01,
	0x0e, 0x1f, 0x2f, 0x1f, 0x2e, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x80, 0x58, 0xfc, 0xf4, 0xf0, 0xf0,
	0xf6, 0x26, 0x70, 0x70, 0x20, 0x80, 0x00, 0x00,
], 15), tmsPalette, 0);
writeIndexedPng('extended_laser.png', 8, 8, graphic2Indices(
	[0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55],
	[0x73, 0xba, 0x54, 0x00, 0x00, 0x73, 0xba, 0x54],
), tmsPalette, -1);

// Bank 14 stores the exact eight-tile labels as six pattern rows per tile.
// The cart retains its established status-bar palette while sourcing the glyph
// masks and weapon-level names from the original ROM.
const statusDescriptions = [
	[3, 'status_description_missile_1@atlas=15.png'],
	[4, 'status_description_missile_2@atlas=15.png'],
	[5, 'status_description_napalm@atlas=15.png'],
	[10, 'status_description_uplaser_1@atlas=15.png'],
	[11, 'status_description_uplaser_2@atlas=15.png'],
	[14, 'status_description_laser_1@atlas=15.png'],
	[15, 'status_description_laser_2@atlas=15.png'],
	[16, 'status_description_extended_laser@atlas=15.png'],
];
for (const [assetId, name] of statusDescriptions) {
	writeIndexedPng(name, 64, 8, statusDescriptionIndices(assetId), statusDescriptionPalette, -1);
}
