import { BFont } from '../core/font';
import { $rompack } from '../core/game';

export type ConsoleGlyph = {
	imgId: string;
	width: number;
	height: number;
	advance: number;
};

type CharMap = Record<string, string>;

const ADVANCE_PADDING: number = 0;
const LINE_SPACING: number = 0;
const TAB_SPACES: number = 2;

function buildCharMap(): CharMap {
	const map: CharMap = {
		' ': 'msx_6b_font_space',
		'!': 'msx_6b_font_exclamation',
		'"': 'msx_6b_font_code_0x22',
		'#': 'msx_6b_font_code_0x23',
		'$': 'msx_6b_font_code_0x24',
		'%': 'msx_6b_font_percent',
		'&': 'msx_6b_font_code_0x26',
		'\'': 'msx_6b_font_apostroph',
		'(': 'msx_6b_font_code_0x28',
		')': 'msx_6b_font_code_0x29',
		'*': 'msx_6b_font_code_0x2a',
		'+': 'msx_6b_font_code_0x2b',
		',': 'msx_6b_font_comma',
		'-': 'msx_6b_font_streep',
		'.': 'msx_6b_font_dot',
		'/': 'msx_6b_font_slash',
		':': 'msx_6b_font_colon',
		';': 'msx_6b_font_code_0x3b',
		'<': 'msx_6b_font_code_0x3c',
		'=': 'msx_6b_font_code_0x3d',
		'>': 'msx_6b_font_code_0x3e',
		'?': 'msx_6b_font_question',
		'@': 'msx_6b_font_code_0x40',
		'[': 'msx_6b_font_code_0x5b',
		'\\': 'msx_6b_font_code_0x5c',
		']': 'msx_6b_font_code_0x5d',
		'^': 'msx_6b_font_code_0x5e',
		'_': 'msx_6b_font_line',
		'`': 'msx_6b_font_code_0x60',
		'{': 'msx_6b_font_code_0x7b',
		'|': 'msx_6b_font_code_0x7c',
		'}': 'msx_6b_font_code_0x7d',
		'~': 'msx_6b_font_code_0x7e',
	};
	for (let i = 0; i < 10; i++) {
		const digit = String.fromCharCode(48 + i);
		map[digit] = `msx_6b_font_${digit}`;
	}
	const lowercase = 'abcdefghijklmnopqrstuvwxyz';
	for (let i = 0; i < lowercase.length; i++) {
		const ch = lowercase.charAt(i);
		map[ch] = `msx_6b_font_low_${ch}`;
	}
	const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (let i = 0; i < uppercase.length; i++) {
		const upper = uppercase.charAt(i);
		const lower = upper.toLowerCase();
		map[upper] = `msx_6b_font_${lower}`;
	}
	return map;
}

export class ConsoleFont extends BFont {
	private readonly glyphs: Map<string, ConsoleGlyph> = new Map();
	private readonly advancePadding: number;
	private readonly lineHeightValue: number;
	private readonly spaceAdvanceValue: number;

	constructor() {
		super({});
		this.advancePadding = ADVANCE_PADDING;
		this.resetLetterMap();
		this.spaceAdvanceValue = this.advance(' ');
		this.lineHeightValue = this.computeLineHeight();
	}

	public override char_width(letter: string): number {
		return this.getGlyph(letter).width;
	}

	public override char_height(letter: string): number {
		return this.getGlyph(letter).height;
	}

	public override char_to_img(c: string): string {
		if (c in this.letter_to_img) {
			return this.letter_to_img[c];
		}
		return 'msx_6b_font_question';
	}

	public getGlyph(char: string): ConsoleGlyph {
		let glyph = this.glyphs.get(char);
		if (glyph) {
			return glyph;
		}
		const imgId = this.char_to_img(char);
		const entry = $rompack.img[imgId];
		if (!entry || !entry.imgmeta) {
			throw new Error(`[ConsoleFont] Glyph asset "${imgId}" for character "${char}" not found in rompack.`);
		}
		const width = entry.imgmeta.width;
		const height = entry.imgmeta.height;
		const computed: ConsoleGlyph = {
			imgId,
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

	public lineHeight(): number {
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

	private computeLineHeight(): number {
		const reference = this.getGlyph('A');
		return reference.height + this.advancePadding + LINE_SPACING;
	}

	private resetLetterMap(): void {
		const target = this.letter_to_img as Record<string, string>;
		const keys = Object.keys(target);
		for (let i = 0; i < keys.length; i++) {
			delete target[keys[i]];
		}
		const map = buildCharMap();
		const entries = Object.keys(map);
		for (let i = 0; i < entries.length; i++) {
			const ch = entries[i];
			target[ch] = map[ch];
		}
		target['?'] = 'msx_6b_font_question';
		target['¡'] = 'msx_6b_font_code_0x80';
	}

}
