import type { ConsoleGlyph, ConsoleFontVariant } from './font';
import { ConsoleFont, DEFAULT_CONSOLE_FONT_VARIANT } from './font';

export class ConsoleEditorFont {
	private readonly font: ConsoleFont;
	private readonly glyphCache: Map<string, ConsoleGlyph> = new Map();
	private readonly lineHeightValue: number;
	private readonly spaceAdvanceValue: number;
	private readonly variant: ConsoleFontVariant;

	constructor(variant: ConsoleFontVariant = DEFAULT_CONSOLE_FONT_VARIANT) {
		this.variant = variant;
		this.font = new ConsoleFont({ variant });
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

	public getVariant(): ConsoleFontVariant {
		return this.variant;
	}

	public getRenderFont(): ConsoleFont {
		return this.font;
	}
}
