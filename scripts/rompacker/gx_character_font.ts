import { createCanvas } from 'canvas';

import type { ImageResource, Resource } from './rompacker.rompack';

export const GX_CHARACTER_FONT_ASSET_ID = 'gx_character_font';

const GLYPH_WIDTH = 4;
const GLYPH_HEIGHT = 6;
const GLYPH_WORD_COUNT = 256;
const FIRST_PRINTABLE_ASCII = 0x20;
const LAST_PRINTABLE_ASCII = 0x7e;
const GLYPH_RESOURCE_PATTERN = /^tiny_3b_font_code_0x([0-9a-f]{2})$/;

export function buildGxCharacterFont(resources: readonly Resource[]): Buffer {
	const images: Array<ImageResource | undefined> = new Array(GLYPH_WORD_COUNT);
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if (resource.type !== 'image') {
			continue;
		}
		const match = GLYPH_RESOURCE_PATTERN.exec(resource.name);
		if (match === null) {
			continue;
		}
		const codepoint = parseInt(match[1], 16);
		if (images[codepoint] !== undefined) {
			throw new Error(`[RomPacker] GX character glyph 0x${match[1]} is defined more than once.`);
		}
		images[codepoint] = resource;
	}

	const output = Buffer.alloc(GLYPH_WORD_COUNT * 4);
	const canvas = createCanvas(GLYPH_WIDTH, GLYPH_HEIGHT);
	const context = canvas.getContext('2d');
	for (let codepoint = FIRST_PRINTABLE_ASCII; codepoint <= LAST_PRINTABLE_ASCII; codepoint += 1) {
		const resource = images[codepoint];
		if (resource === undefined || resource.img === undefined) {
			throw new Error(`[RomPacker] GX character glyph 0x${codepoint.toString(16)} is missing.`);
		}
		if (resource.img.width !== GLYPH_WIDTH || resource.img.height !== GLYPH_HEIGHT) {
			throw new Error(`[RomPacker] GX character glyph '${resource.name}' must be ${GLYPH_WIDTH}x${GLYPH_HEIGHT}.`);
		}
		context.clearRect(0, 0, GLYPH_WIDTH, GLYPH_HEIGHT);
		context.drawImage(resource.img, 0, 0);
		const rgba = context.getImageData(0, 0, GLYPH_WIDTH, GLYPH_HEIGHT).data;
		let word = 0;
		for (let pixel = 0; pixel < GLYPH_WIDTH * GLYPH_HEIGHT; pixel += 1) {
			if (rgba[(pixel << 2) + 3] !== 0) {
				word |= 1 << pixel;
			}
		}
		output.writeUInt32LE(word >>> 0, codepoint << 2);
	}
	return output;
}
