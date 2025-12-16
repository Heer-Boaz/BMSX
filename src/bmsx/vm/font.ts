import { BFont, GlyphMap } from '../core/font';

export type VMFontVariant = 'msx' | 'tiny';

type VMFontPreset = {
	prefix: string;
	tabDirtyMarkerAssetId: string;
	buildCharMap(): GlyphMap;
};

export const DEFAULT_VM_FONT_VARIANT: VMFontVariant = 'msx';

const FONT_PRESETS: Record<VMFontVariant, VMFontPreset> = {
	msx: {
		prefix: 'msx_6b_font',
		tabDirtyMarkerAssetId: 'msx_6b_font_ctrl_bel',
		buildCharMap(): GlyphMap {
			return buildMsxCharMap('msx_6b_font');
		},
	},
	tiny: {
		prefix: 'tiny_3b_font',
		tabDirtyMarkerAssetId: 'tiny_3b_font_ctrl_bel',
		buildCharMap(): GlyphMap {
			return buildTinyCharMap('tiny_3b_font');
		},
	},
} as const;

export function getVMFontPreset(variant: VMFontVariant): VMFontPreset {
	return FONT_PRESETS[variant];
}

function buildMsxCharMap(prefix: string): GlyphMap {
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

function buildTinyCharMap(prefix: string): GlyphMap {
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

export class VMFont extends BFont {
	protected readonly preset: VMFontPreset;
	protected readonly variant: VMFontVariant;

	constructor(config?: { variant?: VMFontVariant }) {
		const variant = config?.variant ?? DEFAULT_VM_FONT_VARIANT;
		const preset = getVMFontPreset(variant);
		super(preset.buildCharMap());
		this.variant = variant;
		this.preset = preset;
		// this.resetLetterMap();
	}

	protected resetLetterMap(): void {
		const target = this.letter_to_img;
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
	}

}
