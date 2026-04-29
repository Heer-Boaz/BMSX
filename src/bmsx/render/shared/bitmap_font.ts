import { BIOS_ATLAS_ID, generateAtlasAssetId, type RuntimeRomPackage } from '../../rompack/format';

export type GlyphMap = Record<string, string>;

export type ImageAtlasRect = {
	atlasId: number;
	u: number;
	v: number;
	w: number;
	h: number;
};

export type FontGlyph = {
	imgid: string;
	rect: ImageAtlasRect;
	width: number;
	height: number;
	advance: number;
};

export type BitmapFontGlyphRecord = {
	imgmeta: {
		width: number;
		height: number;
	};
};

export interface BitmapFontSource {
	getGlyphRecord(imgid: string): BitmapFontGlyphRecord;
	getGlyphRect(imgid: string): ImageAtlasRect;
}

export const TAB_SPACES: number = 2;

const DEFAULT_GLYPH_MAP: GlyphMap = {
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
	'¡': 'letter_ij',
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
	'[': 'letter_speakstart',
	']': 'letter_speakend',
	'(': 'letter_haakjeopen',
	')': 'letter_haakjesluit',
	'+': 'letter_question',
};

export class BFont {
	protected readonly glyphs: Map<string, FontGlyph> = new Map();
	protected readonly advancePadding: number;
	protected readonly lineHeightValue: number;
	protected readonly fallbackCharacter: string = '?';
	protected letter_to_img: GlyphMap;

	constructor(protected readonly source: BitmapFontSource, glyphmap?: GlyphMap, advancePadding: number = 0) {
		this.letter_to_img = glyphmap ?? DEFAULT_GLYPH_MAP;
		this.advancePadding = advancePadding;
		this.lineHeightValue = this.char_height('A');
	}

	public char_width(letter: string): number {
		return this.getGlyph(letter).width;
	}

	public char_height(letter: string): number {
		return this.getGlyph(letter).height;
	}

	public char_to_img(c: string): string {
		return this.letter_to_img[c] ?? this.letter_to_img[this.fallbackCharacter]!;
	}

	protected getGlyphRecord(imgid: string) {
		return this.source.getGlyphRecord(imgid);
	}

	protected getGlyphRect(imgid: string): ImageAtlasRect {
		return this.source.getGlyphRect(imgid);
	}

	public textWidth(text: string): number {
		let width = 0;
		for (const char of text) {
			width += this.char_width(char);
		}
		return width;
	}

	public getGlyph(char: string): FontGlyph {
		const glyph = this.glyphs.get(char);
		if (glyph !== undefined) {
			return glyph;
		}
		if (char === '\t' && this.letter_to_img[char] === undefined) {
			const space = this.getGlyph(' ');
			const tabAdvance = space.advance * TAB_SPACES;
				const computed: FontGlyph = {
					imgid: space.imgid,
					rect: space.rect,
					width: tabAdvance,
					height: space.height,
					advance: tabAdvance,
			};
			this.glyphs.set(char, computed);
			return computed;
		}
		const imgid = this.char_to_img(char);
		const record = this.getGlyphRecord(imgid);
		const width = record.imgmeta.width;
		const height = record.imgmeta.height;
			const computed: FontGlyph = {
				imgid,
				rect: this.getGlyphRect(imgid),
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

	public get glyphMap(): GlyphMap {
		return this.letter_to_img;
	}

	public get glyphAdvancePadding(): number {
		return this.advancePadding;
	}

	public measure(text: string): number {
		let width = 0;
		for (let i = 0; i < text.length; i++) {
			const ch = text.charAt(i);
			if (ch === '\n') {
				continue;
			}
			width += this.advance(ch);
		}
		return width;
	}
}

export class RomPackageBitmapFontSource implements BitmapFontSource {
	constructor(
		private readonly romPackage: RuntimeRomPackage,
		private readonly systemPackage: RuntimeRomPackage,
	) {
	}

	public getGlyphRecord(imgid: string): BitmapFontGlyphRecord {
		const record = this.romPackage.img[imgid] ?? this.systemPackage.img[imgid];
		if (!record.imgmeta) {
			throw new Error(`[BFont] Image '${imgid}' is missing font metadata.`);
		}
		return { imgmeta: record.imgmeta };
	}

	public getGlyphRect(imgid: string): ImageAtlasRect {
		const record = this.romPackage.img[imgid] ?? this.systemPackage.img[imgid];
		const meta = record?.imgmeta;
		if (!meta) {
			throw new Error(`[BFont] Image '${imgid}' is missing font metadata.`);
		}
		const atlasId = meta.atlasid ?? BIOS_ATLAS_ID;
		const atlas = (atlasId === BIOS_ATLAS_ID ? this.systemPackage : this.romPackage).img[generateAtlasAssetId(atlasId)];
		const atlasMeta = atlas?.imgmeta;
		if (!atlasMeta || !meta.texcoords) {
			throw new Error(`[BFont] Image '${imgid}' is missing atlas metadata.`);
		}
		const coords = meta.texcoords;
		let minU = coords[0];
		let maxU = coords[0];
		let minV = coords[1];
		let maxV = coords[1];
		for (let index = 2; index < coords.length; index += 2) {
			const u = coords[index];
			const v = coords[index + 1];
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}
		return {
			atlasId,
			u: Math.round(minU * atlasMeta.width),
			v: Math.round(minV * atlasMeta.height),
			w: meta.width,
			h: meta.height,
		};
	}
}
