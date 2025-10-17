type GlyphSegment = {
	x: number;
	y: number;
	length: number;
};

export type ConsoleGlyph = {
	width: number;
	height: number;
	advance: number;
	segments: GlyphSegment[];
};

type GlyphPattern = {
	chars: string[];
	pattern: string[];
};

const BASE_ADVANCE_PADDING: number = 1;
const GLYPH_HEIGHT: number = 6;

const GLYPH_DATA: GlyphPattern[] = [
	{ chars: [' '], pattern: ['00000', '00000', '00000', '00000', '00000', '00000'] },
	{ chars: ['0'], pattern: ['01110', '10101', '10101', '10001', '01110', '00000'] },
	{ chars: ['1'], pattern: ['00100', '01100', '00100', '00100', '01110', '00000'] },
	{ chars: ['2'], pattern: ['01110', '10001', '00010', '00100', '11111', '00000'] },
	{ chars: ['3'], pattern: ['11110', '00001', '00110', '00001', '11110', '00000'] },
	{ chars: ['4'], pattern: ['00010', '00110', '01010', '11111', '00010', '00000'] },
	{ chars: ['5'], pattern: ['11111', '10000', '11110', '00001', '11110', '00000'] },
	{ chars: ['6'], pattern: ['01110', '10000', '11110', '10001', '01110', '00000'] },
	{ chars: ['7'], pattern: ['11111', '00010', '00100', '01000', '10000', '00000'] },
	{ chars: ['8'], pattern: ['01110', '10001', '01110', '10001', '01110', '00000'] },
	{ chars: ['9'], pattern: ['01110', '10001', '01111', '00001', '01110', '00000'] },
	{ chars: ['A', 'a'], pattern: ['01110', '10001', '11111', '10001', '10001', '00000'] },
	{ chars: ['B', 'b'], pattern: ['11110', '10001', '11110', '10001', '11110', '00000'] },
	{ chars: ['C', 'c'], pattern: ['01111', '10000', '10000', '10000', '01111', '00000'] },
	{ chars: ['D', 'd'], pattern: ['11110', '10001', '10001', '10001', '11110', '00000'] },
	{ chars: ['E', 'e'], pattern: ['11111', '10000', '11110', '10000', '11111', '00000'] },
	{ chars: ['F', 'f'], pattern: ['11111', '10000', '11110', '10000', '10000', '00000'] },
	{ chars: ['G', 'g'], pattern: ['01111', '10000', '10111', '10001', '01110', '00000'] },
	{ chars: ['H', 'h'], pattern: ['10001', '10001', '11111', '10001', '10001', '00000'] },
	{ chars: ['I', 'i'], pattern: ['01110', '00100', '00100', '00100', '01110', '00000'] },
	{ chars: ['J', 'j'], pattern: ['00001', '00001', '00001', '10001', '01110', '00000'] },
	{ chars: ['K', 'k'], pattern: ['10001', '10010', '11100', '10010', '10001', '00000'] },
	{ chars: ['L', 'l'], pattern: ['10000', '10000', '10000', '10000', '11111', '00000'] },
	{ chars: ['M', 'm'], pattern: ['10001', '11011', '10101', '10001', '10001', '00000'] },
	{ chars: ['N', 'n'], pattern: ['10001', '11001', '10101', '10011', '10001', '00000'] },
	{ chars: ['O', 'o'], pattern: ['01110', '10001', '10001', '10001', '01110', '00000'] },
	{ chars: ['P', 'p'], pattern: ['11110', '10001', '11110', '10000', '10000', '00000'] },
	{ chars: ['Q', 'q'], pattern: ['01110', '10001', '10001', '10011', '01111', '00001'] },
	{ chars: ['R', 'r'], pattern: ['11110', '10001', '11110', '10010', '10001', '00000'] },
	{ chars: ['S', 's'], pattern: ['01111', '10000', '01110', '00001', '11110', '00000'] },
	{ chars: ['T', 't'], pattern: ['11111', '00100', '00100', '00100', '00100', '00000'] },
	{ chars: ['U', 'u'], pattern: ['10001', '10001', '10001', '10001', '01110', '00000'] },
	{ chars: ['V', 'v'], pattern: ['10001', '10001', '10001', '01010', '00100', '00000'] },
	{ chars: ['W', 'w'], pattern: ['10001', '10001', '10101', '11011', '10001', '00000'] },
	{ chars: ['X', 'x'], pattern: ['10001', '01010', '00100', '01010', '10001', '00000'] },
	{ chars: ['Y', 'y'], pattern: ['10001', '01010', '00100', '00100', '00100', '00000'] },
	{ chars: ['Z', 'z'], pattern: ['11111', '00010', '00100', '01000', '11111', '00000'] },
	{ chars: ['-'], pattern: ['00000', '00000', '11111', '00000', '00000', '00000'] },
	{ chars: ['+'], pattern: ['00100', '00100', '11111', '00100', '00100', '00000'] },
	{ chars: [':'], pattern: ['00000', '00100', '00000', '00100', '00000', '00000'] },
	{ chars: ['/'], pattern: ['00001', '00010', '00100', '01000', '10000', '00000'] },
	{ chars: ['('], pattern: ['00110', '01000', '01000', '01000', '00110', '00000'] },
	{ chars: [')'], pattern: ['01100', '00010', '00010', '00010', '01100', '00000'] },
	{ chars: ['['], pattern: ['01110', '01000', '01000', '01000', '01110', '00000'] },
	{ chars: [']'], pattern: ['01110', '00010', '00010', '00010', '01110', '00000'] },
	{ chars: ['!'], pattern: ['00100', '00100', '00100', '00000', '00100', '00000'] },
	{ chars: ['.'], pattern: ['00000', '00000', '00000', '00100', '00100', '00000'] },
	{ chars: ['?'], pattern: ['01110', '10001', '00010', '00100', '00100', '00000'] },
	{ chars: ['<'], pattern: ['00001', '00010', '00100', '01000', '10000', '00000'] },
	{ chars: ['>'], pattern: ['10000', '01000', '00100', '00010', '00001', '00000'] },
	{ chars: ['='], pattern: ['00000', '11111', '00000', '11111', '00000', '00000'] },
	{ chars: [','], pattern: ['00000', '00000', '00000', '00100', '00100', '01000'] },
];

export class ConsoleFont {
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
		// Ensure lowercase fallbacks mirror uppercase definitions
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
			throw new Error('[ConsoleFont] Missing fallback glyph for "?".');
		}
		this.fallback = question;
		this.lineHeightValue = GLYPH_HEIGHT + BASE_ADVANCE_PADDING + 1;
	}

	public getGlyph(char: string): ConsoleGlyph {
		const glyph = this.glyphs.get(char);
		if (!glyph) {
			return this.fallback;
		}
		return glyph;
	}

	public lineHeight(): number {
		return this.lineHeightValue;
	}

	private compile(pattern: string[]): ConsoleGlyph {
		if (pattern.length !== GLYPH_HEIGHT) {
			throw new Error(`[ConsoleFont] Expected pattern height ${GLYPH_HEIGHT}, received ${pattern.length}.`);
		}
		const width = pattern[0].length;
		for (const row of pattern) {
			if (row.length !== width) {
				throw new Error('[ConsoleFont] Inconsistent row width in glyph pattern.');
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
