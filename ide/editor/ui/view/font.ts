import { DEFAULT_FONT_VARIANT, Font, type FontVariant, type FontStyle } from '../../../../machine/ts/render/shared/bmsx_font';
import type { FontSampling } from 'bmsx/render/shared/bitmap_font';
import { codePointTextAt } from '../../../../machine/ts/common/utf16';

export class EditorFont {
	private font: Font | null = null;
	private readonly styles = new Map<FontStyle, Font>();
	private readonly _variant: FontVariant;
	private columnAdvance: number | undefined;

	constructor(variant: FontVariant = DEFAULT_FONT_VARIANT, public readonly sampling: FontSampling = 'nearest') {
		this._variant = variant;
	}

	private renderFontOwner(): Font {
		if (this.font === null) {
			this.font = new Font({ variant: this._variant, sampling: this.sampling });
		}
		return this.font;
	}

	public advance(char: string): number {
		return this.renderFontOwner().advance(char);
	}

	public get lineHeight(): number {
		return this.renderFontOwner().lineHeight;
	}

	/** Fixed reading-column budgets share the same immutable font measurement. */
	public get charAdvance(): number { return this.columnAdvance ??= this.advance('M'); }

	/** Text-editor width uses fixed tab expansion and no advance for line separators. */
	public readonly measureTextRange = (text: string, start: number, end: number): number => {
		return this.renderFontOwner().measure(text, start, end);
	};

	/** Write a single display line's retained geometry in UTF-16 slots, starting at advances[start]. */
	public writeAdvancePrefix(text: string, advances: number[], start = 0, end = text.length): void {
		const font = this.renderFontOwner();
		let width = advances[start];
		for (let index = start; index < end;) {
			const char = codePointTextAt(text, index), next = index + char.length;
			if (char.length === 2) advances[index + 1] = width;
			width += font.advance(char);
			advances[next] = width;
			index = next;
		}
	}

	public measure(text: string): number {
		return this.renderFontOwner().measure(text);
	}

	public get variant(): FontVariant {
		return this._variant;
	}

	public renderFont(style: FontStyle = 'normal'): Font {
		if (style === 'normal') return this.renderFontOwner();
		let font = this.styles.get(style);
		if (!font) { font = new Font({ variant: this._variant, style, sampling: this.sampling }); this.styles.set(style, font); }
		return font;
	}
}
