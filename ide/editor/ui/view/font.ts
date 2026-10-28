import { DEFAULT_FONT_VARIANT, Font, type FontVariant, type FontStyle } from '../../../../machine/ts/render/shared/bmsx_font';
import type { FontGlyph } from 'bmsx/render/shared/bitmap_font';
import { TAB_SPACES } from '../../../common/constants';

export class EditorFont {
	private font: Font | null = null;
	private readonly styles = new Map<FontStyle, Font>();
	private readonly itemCache: Map<string, FontGlyph> = new Map();
	private readonly _variant: FontVariant;
	private columnAdvance: number | undefined;

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

	/** Fixed reading-column budgets share the same immutable font measurement. */
	public get charAdvance(): number { return this.columnAdvance ??= this.advance('M'); }

	/** Text-editor width uses fixed tab expansion and no advance for line separators. */
	public readonly measureTextRange = (text: string, start: number, end: number): number => {
		let width = 0;
		for (let index = start; index < end; index++) {
			const char = text.charAt(index);
			if (char === '\t') width += this.advance(' ') * TAB_SPACES;
			else if (char !== '\n') width += this.advance(char);
		}
		return width;
	};

	public measure(text: string): number {
		return this.renderFontOwner().measure(text);
	}

	public get variant(): FontVariant {
		return this._variant;
	}

	public renderFont(style: FontStyle = 'normal'): Font {
		if (style === 'normal') return this.renderFontOwner();
		let font = this.styles.get(style);
		if (!font) { font = new Font({ variant: this._variant, style }); this.styles.set(style, font); }
		return font;
	}
}
