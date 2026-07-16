import type { ImageResource, Resource } from './rompacker.rompack';
import { GX_SYSTEM_TEXTURE_X, GX_SYSTEM_TEXTURE_Y } from './gx_texture';

export const BIOS_TERMINAL_GLYPHS_ASSET_ID = 'bios_terminal_glyphs';

const GLYPH_WIDTH = 4;
const GLYPH_HEIGHT = 6;
const GLYPH_WORD_COUNT = 256;
const FIRST_PRINTABLE_ASCII = 0x20;
const LAST_PRINTABLE_ASCII = 0x7e;
const FIRST_LOWERCASE_ASCII = 0x61;
const LAST_LOWERCASE_ASCII = 0x7a;
const GLYPH_RESOURCE_PATTERN = /^tiny_3b_font_code_0x([0-9a-f]{2})$/;

export function buildBiosTerminalGlyphTable(resources: readonly Resource[]): Buffer {
	const images: Array<ImageResource | undefined> = new Array(GLYPH_WORD_COUNT);
	for (let index = 0; index < resources.length; index += 1) {
		const resource = resources[index];
		if (resource.type !== 'image') {
			continue;
		}
		const match = GLYPH_RESOURCE_PATTERN.exec(resource.name);
		if (!match) {
			continue;
		}
		const codepoint = parseInt(match[1], 16);
		if (images[codepoint]) {
			throw new Error(`[RomPacker] BIOS terminal glyph 0x${match[1]} is defined more than once.`);
		}
		images[codepoint] = resource;
	}

	const output = Buffer.alloc(GLYPH_WORD_COUNT * 4);
	for (let codepoint = FIRST_PRINTABLE_ASCII; codepoint <= LAST_PRINTABLE_ASCII; codepoint += 1) {
		const resource = images[codepoint];
		if (!resource || !resource.img) {
			throw new Error(`[RomPacker] BIOS terminal glyph 0x${codepoint.toString(16)} is missing.`);
		}
		if (resource.img.width !== GLYPH_WIDTH || resource.img.height !== GLYPH_HEIGHT) {
			throw new Error(`[RomPacker] BIOS terminal glyph '${resource.name}' must be ${GLYPH_WIDTH}x${GLYPH_HEIGHT}.`);
		}
		// The monitor accepts ordinary ASCII but presents its machine console in
		// uppercase. Encode that policy once in the BIOS-owned physical glyph map;
		// cart fonts and the retained editor bytes remain untouched.
		const displayResource = codepoint >= FIRST_LOWERCASE_ASCII && codepoint <= LAST_LOWERCASE_ASCII
			? images[codepoint - 0x20]!
			: resource;
		output.writeUInt32LE((GX_SYSTEM_TEXTURE_X + displayResource.textureU!) | ((GX_SYSTEM_TEXTURE_Y + displayResource.textureV!) << 16), codepoint << 2);
	}
	return output;
}
