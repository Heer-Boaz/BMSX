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
		' ': 'letter_space',
		'!': 'letter_exclamation',
		'"': 'letter_code_0x22',
		'#': 'letter_code_0x23',
		'$': 'letter_code_0x24',
		'%': 'letter_percent',
		'&': 'letter_code_0x26',
		'\'': 'letter_apostroph',
		'(': 'letter_code_0x28',
		')': 'letter_code_0x29',
		'*': 'letter_code_0x2a',
		'+': 'letter_code_0x2b',
		',': 'letter_comma',
		'-': 'letter_streep',
		'.': 'letter_dot',
		'/': 'letter_slash',
		':': 'letter_colon',
		';': 'letter_code_0x3b',
		'<': 'letter_code_0x3c',
		'=': 'letter_code_0x3d',
		'>': 'letter_code_0x3e',
		'?': 'letter_question',
		'@': 'letter_code_0x40',
		'[': 'letter_code_0x5b',
		'\\': 'letter_code_0x5c',
		']': 'letter_code_0x5d',
		'^': 'letter_code_0x5e',
		'_': 'letter_line',
		'`': 'letter_code_0x60',
		'{': 'letter_code_0x7b',
		'|': 'letter_code_0x7c',
		'}': 'letter_code_0x7d',
		'~': 'letter_code_0x7e',
	};
	for (let i = 0; i < 10; i++) {
		const digit = String.fromCharCode(48 + i);
		map[digit] = `letter_${digit}`;
	}
	const lowercase = 'abcdefghijklmnopqrstuvwxyz';
	for (let i = 0; i < lowercase.length; i++) {
		const ch = lowercase.charAt(i);
		map[ch] = `letter_low_${ch}`;
	}
	const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (let i = 0; i < uppercase.length; i++) {
		const upper = uppercase.charAt(i);
		const lower = upper.toLowerCase();
		map[upper] = `letter_${lower}`;
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
		target['?'] = 'letter_question';
		target['¡'] = 'letter_code_0x80';
	}

}
