import type { ConsoleGlyph } from './font';

type GlyphSegment = {
	x: number;
	y: number;
	length: number;
};

type GlyphPattern = {
	chars: string[];
	pattern: string[];
};

const BASE_ADVANCE_PADDING = 1;
const GLYPH_HEIGHT = 5;

const GLYPH_DATA: GlyphPattern[] = [
	{ chars: [' '], pattern: ['000', '000', '000', '000', '000'] },
	{ chars: ['!'], pattern: ['010', '010', '010', '000', '010'] },
	{ chars: ['"'], pattern: ['101', '101', '000', '000', '000'] },
	{ chars: ['#'], pattern: ['101', '111', '101', '111', '101'] },
	{ chars: ['$'], pattern: ['010', '111', '110', '011', '111'] },
	{ chars: ['%'], pattern: ['110', '001', '010', '100', '011'] },
	{ chars: ['&'], pattern: ['010', '101', '010', '101', '011'] },
	{ chars: ['\''], pattern: ['010', '010', '000', '000', '000'] },
	{ chars: ['('], pattern: ['001', '010', '010', '010', '001'] },
	{ chars: [')'], pattern: ['100', '010', '010', '010', '100'] },
	{ chars: ['*'], pattern: ['101', '010', '111', '010', '101'] },
	{ chars: ['+'], pattern: ['000', '010', '111', '010', '000'] },
	{ chars: [','], pattern: ['000', '000', '000', '010', '100'] },
	{ chars: ['-'], pattern: ['000', '000', '111', '000', '000'] },
	{ chars: ['.'], pattern: ['000', '000', '000', '010', '010'] },
	{ chars: ['/'], pattern: ['001', '001', '010', '100', '100'] },
	{ chars: ['0'], pattern: ['010', '101', '101', '101', '010'] },
	{ chars: ['1'], pattern: ['010', '110', '010', '010', '111'] },
	{ chars: ['2'], pattern: ['110', '001', '010', '100', '111'] },
	{ chars: ['3'], pattern: ['110', '001', '010', '001', '110'] },
	{ chars: ['4'], pattern: ['101', '101', '111', '001', '001'] },
	{ chars: ['5'], pattern: ['111', '100', '110', '001', '110'] },
	{ chars: ['6'], pattern: ['011', '100', '110', '101', '010'] },
	{ chars: ['7'], pattern: ['111', '001', '010', '100', '100'] },
	{ chars: ['8'], pattern: ['010', '101', '010', '101', '010'] },
	{ chars: ['9'], pattern: ['010', '101', '011', '001', '110'] },
	{ chars: [':'], pattern: ['000', '010', '000', '010', '000'] },
	{ chars: [';'], pattern: ['000', '010', '000', '010', '100'] },
	{ chars: ['<'], pattern: ['001', '010', '100', '010', '001'] },
	{ chars: ['='], pattern: ['000', '111', '000', '111', '000'] },
	{ chars: ['>'], pattern: ['100', '010', '001', '010', '100'] },
	{ chars: ['?'], pattern: ['110', '001', '010', '000', '010'] },
	{ chars: ['@'], pattern: ['010', '101', '111', '100', '011'] },
	{ chars: ['A', 'a'], pattern: ['010', '101', '111', '101', '101'] },
	{ chars: ['B', 'b'], pattern: ['110', '101', '110', '101', '110'] },
	{ chars: ['C', 'c'], pattern: ['011', '100', '100', '100', '011'] },
	{ chars: ['D', 'd'], pattern: ['110', '101', '101', '101', '110'] },
	{ chars: ['E', 'e'], pattern: ['111', '100', '110', '100', '111'] },
	{ chars: ['F', 'f'], pattern: ['111', '100', '110', '100', '100'] },
	{ chars: ['G', 'g'], pattern: ['011', '100', '101', '101', '011'] },
	{ chars: ['H', 'h'], pattern: ['101', '101', '111', '101', '101'] },
	{ chars: ['I', 'i'], pattern: ['111', '010', '010', '010', '111'] },
	{ chars: ['J', 'j'], pattern: ['001', '001', '001', '101', '010'] },
	{ chars: ['K', 'k'], pattern: ['101', '101', '110', '101', '101'] },
	{ chars: ['L', 'l'], pattern: ['100', '100', '100', '100', '111'] },
	{ chars: ['M', 'm'], pattern: ['101', '111', '111', '101', '101'] },
	{ chars: ['N', 'n'], pattern: ['101', '111', '111', '111', '101'] },
	{ chars: ['O', 'o'], pattern: ['010', '101', '101', '101', '010'] },
	{ chars: ['P', 'p'], pattern: ['110', '101', '110', '100', '100'] },
	{ chars: ['Q', 'q'], pattern: ['010', '101', '101', '110', '001'] },
	{ chars: ['R', 'r'], pattern: ['110', '101', '110', '101', '101'] },
	{ chars: ['S', 's'], pattern: ['011', '100', '010', '001', '110'] },
	{ chars: ['T', 't'], pattern: ['111', '010', '010', '010', '010'] },
	{ chars: ['U', 'u'], pattern: ['101', '101', '101', '101', '111'] },
	{ chars: ['V', 'v'], pattern: ['101', '101', '101', '110', '010'] },
	{ chars: ['W', 'w'], pattern: ['101', '101', '111', '111', '101'] },
	{ chars: ['X', 'x'], pattern: ['101', '101', '010', '101', '101'] },
	{ chars: ['Y', 'y'], pattern: ['101', '101', '010', '010', '010'] },
	{ chars: ['Z', 'z'], pattern: ['111', '001', '010', '100', '111'] },
	{ chars: ['['], pattern: ['011', '010', '010', '010', '011'] },
	{ chars: ['\\'], pattern: ['100', '100', '010', '001', '001'] },
	{ chars: [']'], pattern: ['110', '010', '010', '010', '110'] },
	{ chars: ['^'], pattern: ['010', '101', '000', '000', '000'] },
	{ chars: ['_'], pattern: ['000', '000', '000', '000', '111'] },
	{ chars: ['`'], pattern: ['100', '010', '000', '000', '000'] },
	{ chars: ['{'], pattern: ['011', '010', '110', '010', '011'] },
	{ chars: ['|'], pattern: ['010', '010', '010', '010', '010'] },
	{ chars: ['}'], pattern: ['110', '010', '011', '010', '110'] },
	{ chars: ['~'], pattern: ['000', '000', '011', '110', '000'] },
];

export class ConsoleEditorFont {
	private readonly glyphs: Map<string, ConsoleGlyph> = new Map();
	private readonly fallback: ConsoleGlyph;
	private readonly lineHeightValue: number;

	constructor() {
		for (const entry of GLYPH_DATA) {
			const compiled = this.compile(entry.pattern);
			for (const label of entry.chars) {
				this.glyphs.set(label, compiled);
			}
		}
		for (const entry of GLYPH_DATA) {
			for (const label of entry.chars) {
				if (label.length === 1) {
					const lower = label.toLowerCase();
					if (!this.glyphs.has(lower)) {
						this.glyphs.set(lower, this.glyphs.get(label)!);
					}
				}
			}
		}
		const question = this.glyphs.get('?');
		if (!question) {
			throw new Error('[ConsoleEditorFont] Missing fallback glyph for "?".');
		}
		this.fallback = question;
		this.lineHeightValue = GLYPH_HEIGHT + 1;
	}

	public getGlyph(char: string): ConsoleGlyph {
		return this.glyphs.get(char) ?? this.fallback;
	}

	public lineHeight(): number {
		return this.lineHeightValue;
	}

	private compile(pattern: string[]): ConsoleGlyph {
		if (pattern.length !== GLYPH_HEIGHT) {
			throw new Error(`[ConsoleEditorFont] Expected pattern height ${GLYPH_HEIGHT}, received ${pattern.length}.`);
		}
		const width = pattern[0].length;
		for (const row of pattern) {
			if (row.length !== width) {
				throw new Error('[ConsoleEditorFont] Inconsistent row width in glyph pattern.');
			}
		}
		const segments: GlyphSegment[] = [];
		for (let y = 0; y < pattern.length; y++) {
			const row = pattern[y];
			let runStart = -1;
			for (let x = 0; x < width; x++) {
				const filled = row.charAt(x) === '1';
				if (filled) {
					if (runStart === -1) {
						runStart = x;
					}
				} else if (runStart !== -1) {
					const length = x - runStart;
					segments.push({ x: runStart, y, length });
					runStart = -1;
				}
			}
			if (runStart !== -1) {
				const length = width - runStart;
				segments.push({ x: runStart, y, length });
			}
		}
		return {
			width,
			height: pattern.length,
			advance: width + BASE_ADVANCE_PADDING,
			segments,
		};
	}
}
