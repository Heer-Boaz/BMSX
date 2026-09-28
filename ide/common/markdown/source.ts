import { NodeProp, TreeFragment, type TreeCursor } from '@lezer/common';
import { GFM, parser } from '@lezer/markdown';
import { changedTextRange } from '../text';
import { TextStyle, type SourceTextStyle } from './model';

const sourceStyle = new NodeProp<TextStyle>();
const sourceParser = parser.configure([GFM, { props: [sourceStyle.add({
	'StrongEmphasis ATXHeading1 ATXHeading2 ATXHeading3 ATXHeading4 ATXHeading5 ATXHeading6 SetextHeading1 SetextHeading2 TableHeader': TextStyle.Bold,
	Emphasis: TextStyle.Italic,
	'InlineCode FencedCode CodeBlock': TextStyle.Code,
	CodeInfo: TextStyle.Italic,
	'Link Image Autolink URL': TextStyle.Link,
	Strikethrough: TextStyle.Strike,
	'HeaderMark QuoteMark ListMark LinkMark EmphasisMark CodeMark StrikethroughMark TableDelimiter TaskMarker Comment CommentBlock': TextStyle.Muted,
})] }]);

const NO_STYLES: readonly SourceTextStyle[] = [];

/** Editable Markdown: source ranges, never rendered text or rewritten delimiters. */
export class MarkdownSource {
	public styles: readonly SourceTextStyle[] = [];
	private source = '';
	private parsedStyles: readonly SourceTextStyle[] = [];
	private overlays: readonly SourceTextStyle[] = NO_STYLES;
	private fragments: readonly TreeFragment[] = [];

	public update(source: string, overlays: readonly SourceTextStyle[] = NO_STYLES): void {
		const change = changedTextRange(this.source, source);
		if (change === undefined && this.overlays === overlays) return;
		if (change !== undefined) {
			const fragments = TreeFragment.applyChanges(this.fragments, [{ fromA: change.start, toA: change.previousEnd, fromB: change.start, toB: change.nextEnd }]);
			const tree = sourceParser.parse(source, fragments);
			this.fragments = TreeFragment.addTree(tree);
			this.source = source;
			const styles: SourceTextStyle[] = [];
			this.project(tree.cursor(), TextStyle.Plain, styles);
			this.parsedStyles = styles;
		}
		this.overlays = overlays;
		if (overlays.length === 0) { this.styles = this.parsedStyles; return; }
		const styles: SourceTextStyle[] = [];
		let index = 0, overlayIndex = 0, from = 0;
		while (from < source.length) {
			const base = this.parsedStyles[index], overlay = overlays[overlayIndex];
			let to = base.to, style = base.style;
			if (overlay) {
				if (overlay.from > from) to = Math.min(to, overlay.from);
				else { to = Math.min(to, overlay.to); style |= overlay.style; }
			}
			this.append(styles, from, to, style); from = to;
			if (from === base.to) index++;
			if (overlay && from === overlay.to) overlayIndex++;
		}
		this.styles = styles;
	}

	private project(cursor: TreeCursor, inherited: TextStyle, styles: SourceTextStyle[]): void {
		const own = cursor.type.prop(sourceStyle);
		const style = own === TextStyle.Muted ? own : inherited | (own ?? TextStyle.Plain);
		let from = cursor.from;
		const to = cursor.to;
		if (cursor.firstChild()) {
			do {
				this.append(styles, from, cursor.from, style);
				this.project(cursor, style, styles);
				from = cursor.to;
			} while (cursor.nextSibling());
			cursor.parent();
		}
		this.append(styles, from, to, style);
	}

	private append(styles: SourceTextStyle[], from: number, to: number, style: TextStyle): void {
		if (from === to) return;
		const previous = styles.at(-1);
		if (previous?.style === style && previous.to === from) previous.to = to;
		else styles.push({ from, to, style });
	}
}
