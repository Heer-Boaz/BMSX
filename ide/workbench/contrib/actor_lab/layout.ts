import type { EditorFont } from '../../../editor/ui/view/font';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { GAME_FRAME_MINIMUM_WIDTH, GAME_FRAME_MINIMUM_HEIGHT, layoutGameFrame } from '../../common/game_frame';
import { GRAPH_NODE_PADDING } from '../../ui/graph/model';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { WORKBENCH_SPLIT_SIZE, type WorkbenchSplitView } from '../../ui/split_view';
import type { ActorLabInput } from './editor_input';

const PADDING = 4;
const OUTLINE_READING_COLUMNS = 32;
const GRAPH_READING_COLUMNS = 32;
const VISIBLE_ROWS = 3;

export type ActorLabLayout = FullWidthWorkbenchLayout & {
	primaryRight: number;
	primaryBottom: number;
	previewVisible: boolean;
	split: WorkbenchSplitView | undefined;
};

export type ActorLabMetrics = {
	readonly rowHeight: number;
	readonly indentWidth: number;
	readonly treeTopOffset: number;
	readonly graphTopOffset: number;
	readonly outlineMinimumWidth: number;
	readonly outlineMinimumHeight: number;
	readonly graphMinimumWidth: number;
	readonly graphMinimumHeight: number;
	readonly previewMinimumWidth: number;
	readonly previewMinimumHeight: number;
};

const measurements = new WeakMap<EditorFont, ActorLabMetrics>();

/** Intrinsic reading and control budgets, independent of guest topology and current labels. */
export function measureActorLab(font: EditorFont): ActorLabMetrics {
	const previous = measurements.get(font);
	if (previous !== undefined) return previous;
	const advance = font.advance('M'), rowHeight = font.lineHeight + 4;
	const indentWidth = Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
	const treeTopOffset = font.lineHeight + 9, graphTopOffset = treeTopOffset + rowHeight;
	const measured: ActorLabMetrics = {
		rowHeight, indentWidth, treeTopOffset, graphTopOffset,
		// The actor is a root row: its disclosure/activity lanes precede the name.
		// Deeper memberships retain ordinary clipping; this is not a maximum-depth promise.
		outlineMinimumWidth: advance * OUTLINE_READING_COLUMNS + indentWidth * 2 + SCROLLBAR_WIDTH + PADDING * 3,
		outlineMinimumHeight: treeTopOffset + rowHeight * VISIBLE_ROWS + PADDING,
		graphMinimumWidth: advance * GRAPH_READING_COLUMNS + GRAPH_NODE_PADDING * 2 + SCROLLBAR_WIDTH + PADDING * 2,
		graphMinimumHeight: graphTopOffset + rowHeight * VISIBLE_ROWS + SCROLLBAR_WIDTH + PADDING,
		previewMinimumWidth: GAME_FRAME_MINIMUM_WIDTH + PADDING * 2,
		previewMinimumHeight: GAME_FRAME_MINIMUM_HEIGHT + PADDING * 2,
	};
	measurements.set(font, measured);
	return measured;
}

/** Compose measured clients without changing selection, guest state or the requested sash ratio. */
export function layoutActorLab(input: ActorLabInput): void {
	const { layout, split, rowSplit } = input;
	const measured = measureActorLab(layout.font!);
	const top = layout.top + 2;
	const bottom = layout.bottom - (input.timeline.visible ? input.timelineLayout.height : 0);
	const graph = input.presentation === 'graph';
	const primaryMinimumWidth = graph ? measured.graphMinimumWidth : measured.outlineMinimumWidth;
	const primaryMinimumHeight = graph ? measured.graphMinimumHeight : measured.outlineMinimumHeight;
	const width = layout.right - layout.left, height = bottom - top;
	if (width >= primaryMinimumWidth + WORKBENCH_SPLIT_SIZE + measured.previewMinimumWidth
		&& height >= Math.max(primaryMinimumHeight, measured.previewMinimumHeight)) {
		split.minimumFirstSize = primaryMinimumWidth + WORKBENCH_SPLIT_SIZE / 2;
		split.minimumSecondSize = measured.previewMinimumWidth + WORKBENCH_SPLIT_SIZE / 2;
		layout.split = split;
	} else if (width >= Math.max(primaryMinimumWidth, measured.previewMinimumWidth)
		&& height >= primaryMinimumHeight + WORKBENCH_SPLIT_SIZE + measured.previewMinimumHeight) {
		rowSplit.minimumFirstSize = primaryMinimumHeight + WORKBENCH_SPLIT_SIZE / 2;
		rowSplit.minimumSecondSize = measured.previewMinimumHeight + WORKBENCH_SPLIT_SIZE / 2;
		layout.split = rowSplit;
	} else layout.split = undefined;
	const active = layout.split;
	active?.layout(layout.left, top, layout.right, bottom);
	layout.previewVisible = active !== undefined;
	layout.primaryRight = active === split ? split.position - WORKBENCH_SPLIT_SIZE / 2 : layout.right;
	layout.primaryBottom = active === rowSplit ? rowSplit.position - WORKBENCH_SPLIT_SIZE / 2 : bottom;
	const left = layout.left + PADDING, right = layout.primaryRight - PADDING;
	const contentBottom = Math.max(top, layout.primaryBottom - PADDING);
	const treeTop = Math.min(contentBottom, top + measured.treeTopOffset);
	input.outline.updateLayout(left, treeTop, right, contentBottom, measured.rowHeight, measured.indentWidth);
	if (graph) input.stateGraph!.viewport.layout(left, Math.min(contentBottom, top + measured.graphTopOffset), right, contentBottom);
	if (active !== undefined) layoutGameFrame(input.previewBounds,
		active === split ? split.position + WORKBENCH_SPLIT_SIZE / 2 + PADDING : layout.left + PADDING,
		active === rowSplit ? rowSplit.position + WORKBENCH_SPLIT_SIZE / 2 + PADDING : top + PADDING,
		layout.right - PADDING, bottom - PADDING);
}
