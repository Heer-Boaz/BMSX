import type { VMFontVariant } from './font';
import type { FontGlyph } from 'bmsx/core/font';
import { VMFont, DEFAULT_VM_FONT_VARIANT } from './font';

export class VMEditorFont {
	private readonly font: VMFont;
	private readonly glyphCache: Map<string, FontGlyph> = new Map();
	private readonly lineHeightValue: number;
	private readonly _variant: VMFontVariant;

	constructor(variant: VMFontVariant = DEFAULT_VM_FONT_VARIANT) {
		this._variant = variant;
		this.font = new VMFont({ variant });
		this.lineHeightValue = this.font.lineHeight;
	}

	public getGlyph(char: string): FontGlyph {
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

	public get variant(): VMFontVariant {
		return this._variant;
	}

	public renderFont(): VMFont {
		return this.font;
	}
}
