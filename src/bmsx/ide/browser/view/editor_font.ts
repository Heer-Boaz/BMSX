import type { FontVariant } from './font';
import type { FontGlyph } from 'bmsx/render/shared/bitmap_font';
import { Font } from './font';
import { DEFAULT_FONT_VARIANT } from '../../../emulator/start_cart';

export class EditorFont {
	private readonly font: Font;
	private readonly glyphCache: Map<string, FontGlyph> = new Map();
	private readonly lineHeightValue: number;
	private readonly _variant: FontVariant;

	constructor(variant: FontVariant = DEFAULT_FONT_VARIANT) {
		this._variant = variant;
		this.font = new Font({ variant });
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

	public get variant(): FontVariant {
		return this._variant;
	}

	public renderFont(): Font {
		return this.font;
	}
}
