import type { ConsoleGlyph, ConsoleFontVariant } from './font';
import { ConsoleFont, DEFAULT_CONSOLE_FONT_VARIANT } from './font';

export class ConsoleEditorFont {
	private readonly font: ConsoleFont;
	private readonly glyphCache: Map<string, ConsoleGlyph> = new Map();
	private readonly lineHeightValue: number;
	private readonly _variant: ConsoleFontVariant;

	constructor(variant: ConsoleFontVariant = DEFAULT_CONSOLE_FONT_VARIANT) {
		this._variant = variant;
		this.font = new ConsoleFont({ variant });
		this.lineHeightValue = this.font.lineHeight;
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
		return this.getGlyph(char).advance;
	}

	public get lineHeight(): number {
		return this.lineHeightValue;
	}

	public measure(text: string): number {
		return this.font.measure(text);
	}

	public get variant(): ConsoleFontVariant {
		return this._variant;
	}

	public renderFont(): ConsoleFont {
		return this.font;
	}
}
