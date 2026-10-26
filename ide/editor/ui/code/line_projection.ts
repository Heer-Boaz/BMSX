import type { CodeLineView, HighlightLine } from '../../../common/models';
import { COLOR_COMPLETION_PREVIEW_TEXT, TAB_SPACES } from '../../../common/constants';
import { expandTabs } from '../../../common/text';
import type { InlineEditState } from '../code_editor_state';
import type { EditorFont } from '../view/font';

/** One admitted inline edit projects a source highlight without changing its model or cache. */
export class CodeLineProjection {
	private readonly inline = { startColumn: 0, endColumn: 0, startDisplay: 0, endDisplay: 0 };
	public readonly line: CodeLineView = {
		src: '', viewText: '', viewColumnToDisplay: [],
		hi: { text: '', upperText: '', colors: [], columnToDisplay: [] },
		displayToColumn: [], advancePrefix: [], inline: this.inline,
	};
	private sourceHighlight: HighlightLine | undefined;
	private sourceAdvances: readonly number[] | undefined;
	private version = -1;

	public constructor(private readonly font: EditorFont) {}

	public update(source: CodeLineView, state: Readonly<InlineEditState>): CodeLineView {
		if (this.sourceAdvances === source.advancePrefix && this.line.src === source.src && this.version === state.version) {
			if (this.sourceHighlight !== source.hi) this.refreshColors(source.hi);
			this.sourceHighlight = source.hi;
			return this.line;
		}
		this.sourceHighlight = source.hi; this.sourceAdvances = source.advancePrefix; this.version = state.version;
		const line = this.line, highlight = source.hi;
		const start = state.startColumn, end = state.endColumn;
		const prefixEnd = highlight.columnToDisplay[start], tailStart = highlight.columnToDisplay[end];
		const ghost = expandTabs(state.text), ghostEnd = prefixEnd + ghost.length;
		line.src = source.src;
		line.viewText = source.src.slice(0, start) + state.text + source.src.slice(end);
		line.hi.text = highlight.text.slice(0, prefixEnd) + ghost + highlight.text.slice(tailStart);
		line.hi.upperText = highlight.upperText.slice(0, prefixEnd)
			+ (state.preserveCase ? ghost : ghost.toUpperCase()) + highlight.upperText.slice(tailStart);
		this.inline.startColumn = start; this.inline.endColumn = end;
		this.inline.startDisplay = prefixEnd; this.inline.endDisplay = ghostEnd;

		this.refreshColors(highlight);

		const sourceMap = line.hi.columnToDisplay;
		sourceMap.length = source.src.length + 1;
		for (let column = 0; column <= source.src.length; column++) {
			sourceMap[column] = column <= start ? highlight.columnToDisplay[column]
				: column < end ? prefixEnd : ghostEnd + highlight.columnToDisplay[column] - tailStart;
		}

		const viewMap = line.viewColumnToDisplay;
		viewMap.length = line.viewText.length + 1;
		for (let column = 0; column < start; column++) viewMap[column] = highlight.columnToDisplay[column];
		let display = prefixEnd;
		for (let column = 0; column < state.text.length; column++) {
			viewMap[start + column] = display;
			display += state.text.charAt(column) === '\t' ? TAB_SPACES : 1;
		}
		for (let column = end; column <= source.src.length; column++) {
			viewMap[start + state.text.length + column - end] = ghostEnd + highlight.columnToDisplay[column] - tailStart;
		}

		const inverse = line.displayToColumn;
		inverse.length = line.hi.text.length + 1;
		for (let index = 0; index < prefixEnd; index++) inverse[index] = source.displayToColumn[index];
		for (let index = prefixEnd; index < ghostEnd; index++) inverse[index] = start;
		for (let index = tailStart; index <= highlight.text.length; index++) inverse[ghostEnd + index - tailStart] = source.displayToColumn[index];

		const advances = line.advancePrefix;
		advances.length = line.hi.text.length + 1;
		for (let index = 0; index <= prefixEnd; index++) advances[index] = source.advancePrefix[index];
		let width = source.advancePrefix[prefixEnd];
		for (let index = 0; index < ghost.length; index++) {
			width += this.font.advance(ghost.charAt(index)); advances[prefixEnd + index + 1] = width;
		}
		for (let index = tailStart; index <= highlight.text.length; index++) {
			advances[ghostEnd + index - tailStart] = width + source.advancePrefix[index] - source.advancePrefix[tailStart];
		}
		return line;
	}

	/** Recoloring shared source tokens leaves this control's injected geometry intact. */
	private refreshColors(highlight: HighlightLine): void {
		const colors = this.line.hi.colors, prefixEnd = this.inline.startDisplay, ghostEnd = this.inline.endDisplay;
		const tailStart = highlight.columnToDisplay[this.inline.endColumn];
		colors.length = this.line.hi.text.length;
		for (let display = 0; display < prefixEnd; display++) colors[display] = highlight.colors[display];
		for (let display = prefixEnd; display < ghostEnd; display++) colors[display] = COLOR_COMPLETION_PREVIEW_TEXT;
		for (let display = tailStart; display < highlight.text.length; display++) colors[ghostEnd + display - tailStart] = highlight.colors[display];
	}
}
