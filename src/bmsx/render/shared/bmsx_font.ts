import { BFont, GlyphMap } from './bitmap_font';

export const DEFAULT_FONT_VARIANT = 'msx' as const;

export type FontVariant = 'msx' | 'tiny';

const FONT_PRESETS: Record<FontVariant, GlyphMap> = {
	msx: buildMsxCharMap(),
	tiny: buildTinyCharMap(),
} as const;

function buildMsxCharMap(): GlyphMap {
	const prefix = 'msx_6b_font';
	const withPrefix = (suffix: string): string => `${prefix}_${suffix}`;
	const map: GlyphMap = {
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
		'–': withPrefix('streep'),
		'.': withPrefix('dot'),
		'/': withPrefix('slash'),
		':': withPrefix('colon'),
		';': withPrefix('code_0x3b'),
		'<': withPrefix('code_0x3c'),
		'=': withPrefix('code_0x3d'),
		'>': withPrefix('code_0x3e'),
		'?': withPrefix('question'),
		'@': withPrefix('at_sign'),
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
		'¡': withPrefix('code_0x80'),
		// '¤': withPrefix('flower'),
		// '¦': withPrefix('brokenbar'),
		// '§': withPrefix('section'),
		// '£': withPrefix('pound'),
		// '¥': withPrefix('yen'),
		// '€': withPrefix('euro'),
		// 'µ': withPrefix('euler'),
		// 'ĳ': withPrefix('low_ij'),
		// 'Ĳ': withPrefix('ij'),
		'█': withPrefix('code_0xc8'),
		'—': withPrefix('ctrl_etb'), // etb = "extended dash/break" and the associated ASCII control code is 0x17
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

function buildTinyCharMap(): GlyphMap {
	const prefix = 'tiny_3b_font';
	const withPrefix = (suffix: string): string => `${prefix}_${suffix}`;
	const map: GlyphMap = {
		' ': withPrefix('space'),
		'!': withPrefix('exclamation'),
		'@': withPrefix('at_sign'),
		'#': withPrefix('hash'),
		'$': withPrefix('dollar'),
		'%': withPrefix('percent'),
		'&': withPrefix('ampersand'),
		'"': withPrefix('quote'),
		'\'': withPrefix('apostroph'),
		'(': withPrefix('parenopen'),
		')': withPrefix('parenclose'),
		'*': withPrefix('asterisk'),
		'+': withPrefix('plus'),
		',': withPrefix('comma'),
		'-': withPrefix('streep'),
		'–': withPrefix('streep'),
		'—': withPrefix('streep'),
		'.': withPrefix('dot'),
		'/': withPrefix('slash'),
		':': withPrefix('colon'),
		';': withPrefix('semicolon'),
		'~': withPrefix('tilde'),
		'<': withPrefix('lessthan'),
		'=': withPrefix('equals'),
		'>': withPrefix('greaterthan'),
		'?': withPrefix('question'),
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
		'█': withPrefix('line'),
		'¡': withPrefix('inverted_exclamation'),
		'¤': withPrefix('flower'),
		'¦': withPrefix('brokenbar'),
		'§': withPrefix('section'),
		'£': withPrefix('pound'),
		'¥': withPrefix('yen'),
		'€': withPrefix('euro'),
		'µ': withPrefix('euler'),
		'ĳ': withPrefix('low_ij'),
		'Ĳ': withPrefix('ij'),
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

export class Font extends BFont {
	constructor(config?: { variant?: FontVariant }) {
		const variant = config?.variant ?? DEFAULT_FONT_VARIANT;
		const preset = FONT_PRESETS[variant];
		super(preset);
	}
}
