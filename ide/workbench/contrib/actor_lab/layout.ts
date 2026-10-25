import type { EditorFont } from '../../../editor/ui/view/font';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { GAME_FRAME_MINIMUM_WIDTH, GAME_FRAME_MINIMUM_HEIGHT, layoutGameFrame } from '../../common/game_frame';
import { GRAPH_NODE_PADDING } from '../../ui/graph/model';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { ActorLabInput } from './editor_input';

const PADDING = 4;
const SPLIT_GAP = 4;
const OUTLINE_READING_COLUMNS = 32;
const GRAPH_READING_COLUMNS = 32;
const VISIBLE_ROWS = 3;

export type ActorLabLayout = FullWidthWorkbenchLayout & {
	primaryRight: number;
	previewVisible: boolean;
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
	const { layout, split } = input;
	const measured = measureActorLab(layout.font!);
	const top = layout.top + 2;
	const bottom = layout.bottom - (input.timeline.visible ? input.timelineLayout.height : 0);
	const graph = input.presentation === 'graph';
	const primaryMinimumWidth = graph ? measured.graphMinimumWidth : measured.outlineMinimumWidth;
	const primaryMinimumHeight = graph ? measured.graphMinimumHeight : measured.outlineMinimumHeight;
	layout.previewVisible = layout.right - layout.left >= primaryMinimumWidth + SPLIT_GAP + measured.previewMinimumWidth
		&& bottom - top >= Math.max(primaryMinimumHeight, measured.previewMinimumHeight);
	split.minimumFirstSize = primaryMinimumWidth + SPLIT_GAP / 2;
	split.minimumSecondSize = measured.previewMinimumWidth + SPLIT_GAP / 2;
	split.layout(layout.left, top, layout.right, bottom);
	layout.primaryRight = layout.previewVisible ? split.position - SPLIT_GAP / 2 : layout.right;
	const left = layout.left + PADDING, right = layout.primaryRight - PADDING;
	const contentBottom = Math.max(top, bottom - PADDING);
	const treeTop = Math.min(contentBottom, top + measured.treeTopOffset);
	input.outline.updateLayout(left, treeTop, right, contentBottom, measured.rowHeight, measured.indentWidth);
	if (graph) input.stateGraph!.viewport.layout(left, Math.min(contentBottom, top + measured.graphTopOffset), right, contentBottom);
	if (layout.previewVisible) layoutGameFrame(input.previewBounds, split.position + SPLIT_GAP / 2 + PADDING,
		top + PADDING, layout.right - PADDING, bottom - PADDING);
}
