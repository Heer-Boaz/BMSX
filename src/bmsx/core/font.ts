import { $ } from './engine_core';
import { tokenKeyFromId } from '../util/asset_tokens';

export type GlyphMap = Record<string, string>;

export type FontGlyph = {
	imgid: string;
	width: number;
	height: number;
	advance: number;
};

export const TAB_SPACES: number = 2;

const KonamiGlyphMap: GlyphMap = {
	'0': 'letter_0',
	'1': 'letter_1',
	'2': 'letter_2',
	'3': 'letter_3',
	'4': 'letter_4',
	'5': 'letter_5',
	'6': 'letter_6',
	'7': 'letter_7',
	'8': 'letter_8',
	'9': 'letter_9',
	'a': 'letter_a',
	'b': 'letter_b',
	'c': 'letter_c',
	'd': 'letter_d',
	'e': 'letter_e',
	'f': 'letter_f',
	'g': 'letter_g',
	'h': 'letter_h',
	'i': 'letter_i',
	'j': 'letter_j',
	'k': 'letter_k',
	'l': 'letter_l',
	'm': 'letter_m',
	'n': 'letter_n',
	'o': 'letter_o',
	'p': 'letter_p',
	'q': 'letter_q',
	'r': 'letter_r',
	's': 'letter_s',
	't': 'letter_t',
	'u': 'letter_u',
	'v': 'letter_v',
	'w': 'letter_w',
	'x': 'letter_x',
	'y': 'letter_y',
	'z': 'letter_z',
	// 'a': 'letter_low_a',
	// 'b': 'letter_low_b',
	// 'c': 'letter_low_c',
	// 'd': 'letter_low_d',
	// 'e': 'letter_low_e',
	// 'f': 'letter_low_f',
	// 'g': 'letter_low_g',
	// 'h': 'letter_low_h',
	// 'i': 'letter_low_i',
	// 'j': 'letter_low_j',
	// 'k': 'letter_low_k',
	// 'l': 'letter_low_l',
	// 'm': 'letter_low_m',
	// 'n': 'letter_low_n',
	// 'o': 'letter_low_o',
	// 'p': 'letter_low_p',
	// 'q': 'letter_low_q',
	// 'r': 'letter_low_r',
	// 's': 'letter_low_s',
	// 't': 'letter_low_t',
	// 'u': 'letter_low_u',
	// 'v': 'letter_low_v',
	// 'w': 'letter_low_w',
	// 'x': 'letter_low_x',
	// 'y': 'letter_low_y',
	// 'z': 'letter_low_z',
	'A': 'letter_a',
	'B': 'letter_b',
	'C': 'letter_c',
	'D': 'letter_d',
	'E': 'letter_e',
	'F': 'letter_f',
	'G': 'letter_g',
	'H': 'letter_h',
	'I': 'letter_i',
	'J': 'letter_j',
	'K': 'letter_k',
	'L': 'letter_l',
	'M': 'letter_m',
	'N': 'letter_n',
	'O': 'letter_o',
	'P': 'letter_p',
	'Q': 'letter_q',
	'R': 'letter_r',
	'S': 'letter_s',
	'T': 'letter_t',
	'U': 'letter_u',
	'V': 'letter_v',
	'W': 'letter_w',
	'X': 'letter_x',
	'Y': 'letter_y',
	'Z': 'letter_z',
	'¡': 'letter_ij', // Dutch letter 'IJ'
	',': 'letter_comma',
	'.': 'letter_dot',
	'!': 'letter_exclamation',
	'?': 'letter_question',
	'\'': 'letter_apostroph',
	' ': 'letter_space',
	':': 'letter_colon',
	'-': 'letter_streep',
	'–': 'letter_streep',
	'—': 'letter_streep',
	'_': 'letter_line',
	'█': 'letter_line',
	'/': 'letter_slash',
	'%': 'letter_percent',
	'[': 'letter_speakstart', // opening square bracket
	']': 'letter_speakend', // closing square bracket
	'(': 'letter_haakjeopen', // opening parenthesis
	')': 'letter_haakjesluit', // closing parenthesis
	'+': 'letter_question',
};

/**
 * Represents a bitmap font used for rendering text.
 */
export class BFont {
	/**
	 * The map of font resources.
	 */
	// protected accessor font_res_map: Record<string, string>;
	protected readonly glyphs: Map<string, FontGlyph> = new Map();
	protected readonly advancePadding: number;
	protected readonly lineHeightValue: number;
	protected readonly spaceAdvanceValue: number;
	protected readonly fallbackCharacter: string = '?'; // Default to question mark if character is not found

	protected letter_to_img: GlyphMap;

	/**
	 * Creates a new instance of the `BFont` class.
	 * @param glyphmap A mapping from characters to assets image ids.
	 * @param advancePadding Extra pixels added to glyph advance.
	 */
	constructor(glyphmap?: GlyphMap, advancePadding: number = 0) {
		this.letter_to_img = glyphmap ?? KonamiGlyphMap;
		this.advancePadding = advancePadding;
		this.spaceAdvanceValue = this.advance(' ');
		this.lineHeightValue = this.char_height('A');
	}

	public char_width(letter: string): number {
		return this.getGlyph(letter).width;
	}

	public char_height(letter: string): number {
		return this.getGlyph(letter).height;
	}

	/**
	 * Converts a character to an image.
	 * @param c The character to convert.
	 * @returns The image as a string.
	 */
	public char_to_img(c: string): string {
		let letter: string;
		if (c in this.letter_to_img) {
			letter = this.letter_to_img[c];
		} else {
			console.warn(`[BFont]: Character '${c}' not found in letter_to_img map.`);
			letter = this.letter_to_img[this.fallbackCharacter];
		}
		return letter;
	}

	public textWidth(text: string): number {
		let width = 0;
		for (const char of text) {
			width += this.char_width(char);
		}
		return width;
	}

	public getGlyph(char: string): FontGlyph {
		let glyph = this.glyphs.get(char);
		if (glyph) {
			return glyph;
		}
		const imgid = this.char_to_img(char);
		const asset = $.assets.img[tokenKeyFromId(imgid)];
		if (!asset) {
			throw new Error(`[BFont] Glyph asset "${imgid}" for character "${char}" not found.`);
		}
		const meta = asset.imgmeta;
		if (!meta) {
			throw new Error(`[BFont] Glyph asset "${imgid}" for character "${char}" missing metadata.`);
		}
		const width = meta.width;
		const height = meta.height;
		const computed: FontGlyph = {
			imgid: imgid,
			width,
			height,
			advance: width + this.advancePadding,
		};
		this.glyphs.set(char, computed);
		return computed;
	}

	public advance(char: string): number {
		return this.getGlyph(char).advance;
	}

	public get lineHeight(): number {
		return this.lineHeightValue;
	}

	public measure(text: string): number {
		let width = 0;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\t') {
				width += this.spaceAdvanceValue * TAB_SPACES;
				continue;
			}
			if (ch === '\n') {
				continue;
			}
			width += this.advance(ch);
		}
		return width;
	}

}
