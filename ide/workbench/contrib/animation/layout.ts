import type { EditorFont } from '../../../editor/ui/view/font';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorCommandTitle } from '../../../commands/catalog';
import { truncateMeasuredText } from '../../../common/text';
import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, WORKBENCH_ACTION_BAR_ITEM_PADDING_X, WORKBENCH_ACTION_BAR_ITEM_SPACING } from '../../ui/action_bar';
import { clampWorkbenchListScroll, layoutWorkbenchList } from '../../ui/list_view';
import { layoutWorkbenchPropertyTree, measureWorkbenchPropertyTreeMinimumWidth } from '../../ui/property_tree';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { AnimationEditorInput } from './editor_input';
import type { AnimationKeyControl } from './key_control';

const PADDING = 4;
const SASH_SPACE = 8;
const ACTION_GROUP_GAP = 4;
const TRACK_LABEL_COLUMNS = 12;
const PROPERTY_NAME_COLUMNS = 15;
const KEY_AXIS_COLUMNS = 20;
const VISIBLE_ROWS = 3;

export type AnimationEditorMetrics = {
	readonly rowHeight: number;
	readonly headerHeight: number;
	readonly selectorWidth: number;
	readonly tracksWidth: number;
	readonly detailsWidth: number;
	readonly keysWidth: number;
	readonly tracksHeight: number;
	readonly detailsHeight: number;
	readonly keysHeight: number;
	readonly curveHeight: number;
	readonly compactWidth: number;
	readonly compactHeight: number;
	readonly expandedWidth: number;
	readonly expandedHeight: number;
};

export type AnimationEditorLayout = {
	readonly bounds: RectBounds;
	font: EditorFont | undefined;
	mode: 'expanded' | 'compact';
	rowHeight: number;
	tracksVisible: boolean;
	keysVisible: boolean;
	detailsVisible: boolean;
};

const measurements = new WeakMap<EditorFont, AnimationEditorMetrics>();

/** Intrinsic controls and readable text budgets, independent of the current source values or zoom. */
export function measureAnimationEditor(font: EditorFont): AnimationEditorMetrics {
	const previous = measurements.get(font);
	if (previous !== undefined) return previous;
	const rowHeight = Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 4;
	const headerHeight = rowHeight + 6;
	const tracksWidth = font.advance('M') * TRACK_LABEL_COLUMNS + PADDING * 2;
	const detailsWidth = measureWorkbenchPropertyTreeMinimumWidth(font.renderFont(), PROPERTY_NAME_COLUMNS, 10);
	const keysWidth = font.advance('M') * KEY_AXIS_COLUMNS + PADDING * 2;
	const tracksHeight = rowHeight * VISIBLE_ROWS;
	const detailsHeight = rowHeight * VISIBLE_ROWS + font.lineHeight * 3 + 8;
	const curveHeight = rowHeight * VISIBLE_ROWS;
	const keysHeight = rowHeight * 4 + curveHeight;
	const selectorWidth = font.measure(editorCommandTitle('animation.tracks', false, true))
		+ font.measure(editorCommandTitle('animation.keys', false, true)) + font.measure(editorCommandTitle('animation.details', false, true))
		+ WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 6 + WORKBENCH_ACTION_BAR_ITEM_SPACING * 2;
	const measured: AnimationEditorMetrics = {
		rowHeight, headerHeight, selectorWidth, tracksWidth, detailsWidth, keysWidth, tracksHeight, detailsHeight, keysHeight, curveHeight,
		compactWidth: Math.max(selectorWidth + ACTION_GROUP_GAP + Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, rowHeight), tracksWidth, detailsWidth, keysWidth) + PADDING * 2,
		compactHeight: headerHeight + Math.max(tracksHeight, detailsHeight, keysHeight) + PADDING,
		expandedWidth: Math.max(tracksWidth, detailsWidth) + SASH_SPACE + keysWidth + PADDING * 2,
		expandedHeight: headerHeight + tracksHeight + SASH_SPACE + Math.max(detailsHeight, keysHeight) + PADDING,
	};
	measurements.set(font, measured);
	return measured;
}

/** Only visible clients receive geometry. Hidden client state and the user's requested sash ratios stay retained. */
export function layoutAnimationEditor(input: AnimationEditorInput, bounds: Readonly<RectBounds>, keys: AnimationKeyControl): void {
	const { font } = editorViewState;
	const measured = measureAnimationEditor(font), layout = input.layout;
	const { rowHeight } = measured;
	write_rect_bounds(layout.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
	layout.font = font;
	layout.rowHeight = rowHeight;
	const expanded = input.keys.unit !== undefined
		&& bounds.right - bounds.left >= measured.expandedWidth && bounds.bottom - bounds.top >= measured.expandedHeight;
	layout.mode = expanded ? 'expanded' : 'compact';
	layout.tracksVisible = expanded || input.activeClient === 'tracks';
	layout.keysVisible = expanded || input.activeClient === 'keys';
	layout.detailsVisible = expanded || input.activeClient === 'details';
	for (const item of input.actionBar.items) {
		if (item.command === 'animation.addFrame') item.visible = input.document?.family === 'sprite';
		else if (item.command === 'animation.addTrack' || item.command === 'animation.addKey') item.visible = input.document?.family === 'timeline';
	}
	for (const item of input.clientBar.items) item.checked = item.command === `animation.${input.activeClient}`;
	const selectorRight = bounds.left + PADDING + measured.selectorWidth;
	layoutWorkbenchActionBar(input.clientBar, selectorRight, bounds.top, bounds.top + rowHeight, measureText, font.renderFont(), bounds.left + PADDING);
	layoutWorkbenchActionBar(input.actionBar, bounds.right - PADDING, bounds.top, bounds.top + rowHeight,
		measureText, font.renderFont(), selectorRight + ACTION_GROUP_GAP);
	const left = bounds.left + PADDING, right = bounds.right - PADDING;
	const top = bounds.top + measured.headerHeight, bottom = bounds.bottom - PADDING;
	let tracksRight = right, tracksBottom = bottom, detailsRight = right, detailsTop = top, keysLeft = left, keysTop = top;
	if (expanded) {
		const columns = input.columnSplit, rows = input.rowSplit;
		columns.minimumFirstSize = Math.max(measured.tracksWidth, measured.detailsWidth) + SASH_SPACE / 2;
		columns.minimumSecondSize = measured.keysWidth + SASH_SPACE / 2;
		columns.layout(left, top, right, bottom);
		rows.minimumFirstSize = measured.tracksHeight + SASH_SPACE / 2;
		rows.minimumSecondSize = Math.max(measured.detailsHeight, measured.keysHeight) + SASH_SPACE / 2;
		rows.layout(left, top, right, bottom);
		tracksRight = detailsRight = columns.position - SASH_SPACE / 2;
		keysLeft = columns.position + SASH_SPACE / 2;
		tracksBottom = rows.position - SASH_SPACE / 2;
		detailsTop = keysTop = rows.position + SASH_SPACE / 2;
		input.overview.layout(keysLeft, top, right, tracksBottom);
	}
	if (layout.tracksVisible) {
		layoutWorkbenchList(input.tracks.layout, left, top, tracksRight, tracksBottom, rowHeight);
		clampWorkbenchListScroll(input.tracks);
		for (const row of input.tracks.rows) row.text = truncateMeasuredText(row.label, tracksRight - left - 4, measureTextRange);
	}
	if (layout.keysVisible) {
		keys.layout(keysLeft, keysTop + rowHeight, right, keysTop + rowHeight * 2);
		input.keys.curve.layout(keysLeft, keysTop + rowHeight * 4, right, bottom);
	}
	if (layout.detailsVisible) layoutWorkbenchPropertyTree(input.details, font.renderFont(), measureTextRange, left, detailsTop, detailsRight, bottom);
}
