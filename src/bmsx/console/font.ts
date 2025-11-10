import { BFont } from '../core/font';
import { $rompack } from '../core/game';

export type ConsoleGlyph = {
	imgId: string;
	width: number;
	height: number;
	advance: number;
};

export type ConsoleFontVariant = 'msx' | 'tiny';

type ConsoleFontPreset = {
	prefix: string;
	fallbackSprite: string;
	tabDirtyMarkerAssetId: string;
	buildCharMap(): CharMap;
};

type CharMap = Record<string, string>;

const ADVANCE_PADDING: number = 0;
const LINE_SPACING: number = 0;
const TAB_SPACES: number = 2;
export const DEFAULT_CONSOLE_FONT_VARIANT: ConsoleFontVariant = 'msx';

const FONT_PRESETS: Record<ConsoleFontVariant, ConsoleFontPreset> = {
	msx: {
		prefix: 'msx_6b_font',
		fallbackSprite: 'msx_6b_font_question',
		tabDirtyMarkerAssetId: 'msx_6b_font_ctrl_bel',
		buildCharMap(): CharMap {
			return buildMsxCharMap('msx_6b_font');
		},
	},
	tiny: {
		prefix: 'tiny_3b_font',
		fallbackSprite: 'tiny_3b_font_question',
		tabDirtyMarkerAssetId: 'tiny_3b_font_ctrl_bel',
		buildCharMap(): CharMap {
			return buildTinyCharMap('tiny_3b_font');
		},
	},
} as const;

export function getConsoleFontPreset(variant: ConsoleFontVariant): ConsoleFontPreset {
	return FONT_PRESETS[variant];
}

function buildMsxCharMap(prefix: string): CharMap {
	const withPrefix = (suffix: string): string => `${prefix}_${suffix}`;
	const map: CharMap = {
		' ': withPrefix('space'),
		'!': withPrefix('exclamation'),
		'"': withPrefix('code_0x22'),
		'#': withPrefix('code_0x23'),
		'$': withPrefix('code_0x24'),
		'%': withPrefix('percent'),
		'&': withPrefix('code_0x26'),
		'\'': withPrefix('apostroph'),
		'(': withPrefix('code_0x28'),
		')': withPrefix('code_0x29'),
		'*': withPrefix('code_0x2a'),
		'+': withPrefix('code_0x2b'),
		',': withPrefix('comma'),
		'-': withPrefix('streep'),
		'.': withPrefix('dot'),
		'/': withPrefix('slash'),
		':': withPrefix('colon'),
		';': withPrefix('code_0x3b'),
		'<': withPrefix('code_0x3c'),
		'=': withPrefix('code_0x3d'),
		'>': withPrefix('code_0x3e'),
		'?': withPrefix('question'),
		'@': withPrefix('code_0x40'),
		'[': withPrefix('code_0x5b'),
		'\\': withPrefix('code_0x5c'),
		']': withPrefix('code_0x5d'),
		'^': withPrefix('code_0x5e'),
		'_': withPrefix('line'),
		'`': withPrefix('code_0x60'),
		'{': withPrefix('code_0x7b'),
		'|': withPrefix('code_0x7c'),
		'}': withPrefix('code_0x7d'),
		'~': withPrefix('code_0x7e'),
		'•': withPrefix('ctrl_bel'),
	};
	for (let i = 0; i < 10; i += 1) {
		const digit = String.fromCharCode(48 + i);
		map[digit] = withPrefix(digit);
	}
	const lowercase = 'abcdefghijklmnopqrstuvwxyz';
	for (let i = 0; i < lowercase.length; i += 1) {
		const ch = lowercase.charAt(i);
		map[ch] = withPrefix(`low_${ch}`);
	}
	const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (let i = 0; i < uppercase.length; i += 1) {
		const upper = uppercase.charAt(i);
		const lower = upper.toLowerCase();
		map[upper] = withPrefix(lower);
	}
	return map;
}

function buildTinyCharMap(prefix: string): CharMap {
	const withPrefix = (suffix: string): string => `${prefix}_${suffix}`;
	const map: CharMap = {
		' ': withPrefix('space'),
		'!': withPrefix('exclamation'),
		'"': withPrefix('quote'),
		'#': withPrefix('hash'),
		'$': withPrefix('dollar'),
		'%': withPrefix('percent'),
		'&': withPrefix('ampersand'),
		'\'': withPrefix('apostroph'),
		'(': withPrefix('parenopen'),
		')': withPrefix('parenclose'),
		'*': withPrefix('asterisk'),
		'+': withPrefix('plus'),
		',': withPrefix('comma'),
		'-': withPrefix('streep'),
		'.': withPrefix('dot'),
		'/': withPrefix('slash'),
		':': withPrefix('colon'),
		';': withPrefix('semicolon'),
		'~': withPrefix('tilde'),
		'<': withPrefix('lessthan'),
		'=': withPrefix('equals'),
		'>': withPrefix('greaterthan'),
		'?': withPrefix('question'),
		'@': withPrefix('empty'),
		'[': withPrefix('bracketopen'),
		'\\': withPrefix('backslash'),
		']': withPrefix('bracketclose'),
		'^': withPrefix('caret'),
		'_': withPrefix('line'),
		'`': withPrefix('backtick'),
		'{': withPrefix('braceopen'),
		'|': withPrefix('pipe'),
		'}': withPrefix('braceclose'),
		'•': withPrefix('bullet'),
	};
	for (let i = 0; i < 10; i += 1) {
		const digit = String.fromCharCode(48 + i);
		map[digit] = withPrefix(digit);
	}
	const lowercase = 'abcdefghijklmnopqrstuvwxyz';
	for (let i = 0; i < lowercase.length; i += 1) {
		const ch = lowercase.charAt(i);
		map[ch] = withPrefix(`low_${ch}`);
	}
	const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	for (let i = 0; i < uppercase.length; i += 1) {
		const upper = uppercase.charAt(i);
		const lower = upper.toLowerCase();
		map[upper] = withPrefix(lower);
	}
	map['¡'] = withPrefix('inverted_exclamation');
	map['¤'] = withPrefix('flower');
	map['¦'] = withPrefix('brokenbar');
	map['§'] = withPrefix('section');
	map['£'] = withPrefix('pound');
	map['¥'] = withPrefix('yen');
	map['€'] = withPrefix('euro');
	map['µ'] = withPrefix('euler');
	map['ĳ'] = withPrefix('low_ij');
	map['Ĳ'] = withPrefix('ij');
	return map;
}

export class ConsoleFont extends BFont {
	private readonly glyphs: Map<string, ConsoleGlyph> = new Map();
	private readonly advancePadding: number;
	private readonly lineHeightValue: number;
	private readonly spaceAdvanceValue: number;
	private readonly preset: ConsoleFontPreset;
	private readonly variant: ConsoleFontVariant;

	constructor(config?: { variant?: ConsoleFontVariant }) {
		super({});
		this.variant = config?.variant ?? DEFAULT_CONSOLE_FONT_VARIANT;
		this.preset = getConsoleFontPreset(this.variant);
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
		return this.preset.fallbackSprite;
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
	const map = this.preset.buildCharMap();
		const entries = Object.keys(map);
		for (let i = 0; i < entries.length; i++) {
			const ch = entries[i];
			target[ch] = map[ch];
		}
		target['?'] = this.preset.fallbackSprite;
		target['¡'] = `${this.preset.prefix}_code_0x80`;
	}

}
