import type { ConsoleGlyph } from './font';
import { ConsoleFont } from './font';

export class ConsoleEditorFont {
	private readonly font: ConsoleFont;
	private readonly glyphCache: Map<string, ConsoleGlyph> = new Map();
	private readonly lineHeightValue: number;
	private readonly spaceAdvanceValue: number;

	constructor() {
		this.font = new ConsoleFont();
		this.lineHeightValue = this.font.lineHeight();
		this.spaceAdvanceValue = this.font.advance(' ');
	}

	public getGlyph(char: string): ConsoleGlyph {
		let glyph = this.glyphCache.get(char);
		if (glyph) {
			return glyph;
		}
		glyph = this.font.getGlyph(char);
		this.glyphCache.set(char, glyph);
		return glyph;
	}

	public advance(char: string): number {
		if (char === ' ') {
			return this.spaceAdvanceValue;
		}
		return this.getGlyph(char).advance;
	}

	public lineHeight(): number {
		return this.lineHeightValue;
	}

	public measure(text: string): number {
		return this.font.measure(text);
	}
}
