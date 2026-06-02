import { DEFAULT_FONT_VARIANT, Font, type FontVariant } from '../../../../render/shared/bmsx_font';
import type { FontGlyph } from 'bmsx/render/shared/bitmap_font';

export class EditorFont {
	private font: Font | null = null;
	private readonly itemCache: Map<string, FontGlyph> = new Map();
	private readonly _variant: FontVariant;

	constructor(variant: FontVariant = DEFAULT_FONT_VARIANT) {
		this._variant = variant;
	}

	private renderFontOwner(): Font {
		if (this.font === null) {
			this.font = new Font({ variant: this._variant });
		}
		return this.font;
	}

	public getGlyph(char: string): FontGlyph {
		let item = this.itemCache.get(char);
		if (item) {
			return item;
		}
		item = this.renderFontOwner().getGlyph(char);
		this.itemCache.set(char, item);
		return item;
	}

	public advance(char: string): number {
		return this.getGlyph(char).advance;
	}

	public get lineHeight(): number {
		return this.renderFontOwner().lineHeight;
	}

	public measure(text: string): number {
		return this.renderFontOwner().measure(text);
	}

	public get variant(): FontVariant {
		return this._variant;
	}

	public renderFont(): Font {
		return this.renderFontOwner();
	}
}
