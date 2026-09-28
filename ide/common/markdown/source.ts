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

/** Editable Markdown: source ranges, never rendered text or rewritten delimiters. */
export class MarkdownSource {
	public styles: readonly SourceTextStyle[] = [];
	private source = '';
	private fragments: readonly TreeFragment[] = [];

	public update(source: string): void {
		const change = changedTextRange(this.source, source);
		if (change === undefined) return;
		const fragments = TreeFragment.applyChanges(this.fragments, [{ fromA: change.start, toA: change.previousEnd, fromB: change.start, toB: change.nextEnd }]);
		const tree = sourceParser.parse(source, fragments);
		this.fragments = TreeFragment.addTree(tree);
		this.source = source;
		const styles: SourceTextStyle[] = [];
		this.project(tree.cursor(), TextStyle.Plain, styles);
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
