import type { RectBounds } from '../../../../machine/ts/common/rect';
import * as colors from '../../../common/constants';
import { buildTextSearchSnippet } from '../../../common/search_text';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import type { TextField } from '../../../editor/ui/inline/text_field_model';
import type { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { drawSingleLineField } from '../../../editor/ui/inline/single_line_render';
import type { EditorFont } from '../../../editor/ui/view/font';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchIcon } from '../../render/icon';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { WorkbenchTreeNode } from '../../ui/tree_view';
import type { WorkspaceSearchInput } from './editor_input';
import type { WorkspaceSearchElement } from './tree';

type ResultLabel = { width: number; font: EditorFont; node: WorkbenchTreeNode<WorkspaceSearchElement>; count: number; text: string; matchStart: number; matchEnd: number; matchLeft: number; matchRight: number };

/** Captured excerpts have stable extents, independent of viewport width. Each row is
 * formatted/measured once per content/font revision, not on horizontal scroll or resize.
 * The query input owns this cache; an old tree cannot retain a reused pane or its next query. */
export class WorkspaceSearchPresentation {
	public readonly labels: ResultLabel[] = [];
	public status = '';
	private width = -1;
	private font: EditorFont | undefined;
	private statusFont: EditorFont | undefined;
	private revision = -1;
	private readonly rowLabels = new WeakMap<WorkbenchTreeNode<WorkspaceSearchElement>, ResultLabel>();
	public constructor(private readonly input: WorkspaceSearchInput) {}
	public reset(): void { this.labels.length = 0; this.width = -1; }
	public update(font: EditorFont): void {
		const input = this.input, tree = input.tree, layout = tree.layout, width = layout.contentRight - layout.contentLeft;
		const invalidate = this.statusFont !== font || this.width !== width;
		this.font = font; this.statusFont = font; this.width = width;
		const first = tree.scroll | 0, end = Math.min(tree.rows.length, first + layout.visibleRowCount);
		for (let index = first; index < end; index++) this.labels[index - first] = this.labelFor(tree.rows[index]);
		this.labels.length = end - first;
		if (invalidate || this.revision !== input.revision) {
			const files = input.search.files, matches = input.search.matchCount;
			const summary = `${matches} ${matches === 1 ? 'match' : 'matches'} in ${files.length} ${files.length === 1 ? 'file' : 'files'}`;
			const state = input.search.status;
			const status = input.pending ? 'Searching…' : input.search.status === 'running' ? `Searching… ${summary}`
				: input.query !== input.search.query ? 'Press Enter to search'
				: state === 'idle' ? 'Search project files'
				: state === 'cancelled' ? `Cancelled — ${summary}`
				: state === 'error' ? `Search failed: ${input.search.error}` : summary;
			this.status = truncateTextToWidth(status + (input.includeShared ? ' · shared sources included' : ''), width);
			this.revision = input.revision;
		}
	}
	public measure(font: EditorFont): void {
		this.font = font;
		this.input.tree.measureContentWidth(this.measureRow, font);
	}
	private readonly measureRow = (node: WorkbenchTreeNode<WorkspaceSearchElement>): number => {
		const font = this.font!, label = this.labelFor(node);
		return (node.depth + 1) * Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 4)
			+ label.width + 4;
	};
	private labelFor(node: WorkbenchTreeNode<WorkspaceSearchElement>): ResultLabel {
		const { file, match } = node.element, font = this.font!, previous = this.rowLabels.get(node);
		if (previous !== undefined && previous.font === font && (match !== undefined || previous.count === file.matches.length)) return previous;
		let text: string, matchStart = 0, matchEnd = 0;
		if (match === undefined) text = `${file.label} (${file.matches.length})`;
		else {
			const prefix = `${match.row + 1}:${match.start + 1}  `;
			const snippet = buildTextSearchSnippet(file.snapshot.source, match.offset, match.end - match.start, 24);
			text = prefix + snippet.text;
			matchStart = prefix.length + snippet.matchStart;
			matchEnd = prefix.length + snippet.matchEnd;
		}
		const label = { node, font, width: font.measureTextRange(text, 0, text.length), count: file.matches.length, text, matchStart, matchEnd,
			matchLeft: font.measureTextRange(text, 0, matchStart), matchRight: font.measureTextRange(text, 0, matchEnd) };
		this.rowLabels.set(node, label);
		return label;
	}
}

export function drawWorkspaceSearch(input: WorkspaceSearchInput, view: WorkspaceSearchPresentation, bounds: Readonly<RectBounds>,
	field: TextField, viewport: SingleLineFieldViewport, fieldBounds: Readonly<RectBounds>, focused: boolean): void {
	const tree = input.tree, layout = tree.layout, font = viewport.renderFont.renderFont();
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	renderWorkbenchActionBar(input.actions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
	api.fill_rect(fieldBounds.left, fieldBounds.top, fieldBounds.right, fieldBounds.bottom, 0, colors.COLOR_INPUT_BACKGROUND);
	api.blit_rect(fieldBounds.left, fieldBounds.top, fieldBounds.right, fieldBounds.bottom, 0, field.focusTarget.hasFocus ? colors.COLOR_FOCUS_BORDER : colors.COLOR_INPUT_OUTLINE);
	drawSingleLineField(field, viewport, colors.COLOR_INPUT_TEXT);
	api.blit_text_inline_with_font(view.status, layout.contentLeft, fieldBounds.bottom + 4, 0, colors.COLOR_DESCRIPTION_TEXT, font);
	api.pushClipRect(layout.contentLeft, layout.contentTop, layout.contentRight, layout.contentBottom);
	const first = tree.scroll | 0;
	for (let slot = 0; slot < view.labels.length; slot++) {
		const label = view.labels[slot], node = label.node, index = first + slot, selected = index === tree.selectionIndex;
		const y = layout.contentTop + slot * layout.rowHeight, x = tree.rowLeft + node.depth * layout.indentWidth;
		const ink = selected ? focused ? colors.COLOR_SELECTION_TEXT : colors.COLOR_INACTIVE_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
		if (selected) api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, focused ? colors.SELECTION_OVERLAY : colors.INACTIVE_SELECTION_OVERLAY);
		else if (index === tree.hoverIndex) api.fill_rect(layout.contentLeft, y, layout.contentRight, y + layout.rowHeight, 0, colors.HIGHLIGHT_OVERLAY);
		if (node.expandable) drawWorkbenchIcon(node.collapsed ? 'chevronRight' : 'chevronDown', x + ((layout.twistieWidth - WORKBENCH_ICON_SIZE) >> 1), y + ((layout.rowHeight - WORKBENCH_ICON_SIZE) >> 1), ink);
		const textLeft = x + layout.twistieWidth;
		api.blit_text_inline_with_font(label.text, textLeft, y + 2, 0, ink, font);
		if (label.matchEnd > label.matchStart) api.fill_rect(textLeft + label.matchLeft, y + layout.rowHeight - 2, textLeft + label.matchRight, y + layout.rowHeight - 1, 0, ink);
	}
	api.popClipRect();
	tree.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	tree.horizontalScrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	api.popClipRect();
}
