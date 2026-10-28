import { clamp } from '../../../../machine/ts/common/clamp';
import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { CartMapInput, CartMapLayoutMode } from './editor_input';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import { measureCartMapGrid } from './grid';

const PADDING = 4;

type CartMapMetrics = { readonly axisLabelWidth: number; readonly fieldMinimumWidth: number; readonly outlineMinimumWidth: number;
	readonly mapMinimumWidth: number; readonly splitMinimumWidth: number };
const measurements = new WeakMap<EditorFont, CartMapMetrics>();

function measureCartMap(font: EditorFont): CartMapMetrics {
	let measured = measurements.get(font);
	if (measured === undefined) {
		const indent = Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
		const axisLabelWidth = Math.max(font.advance('X'), font.advance('Y'));
		const fieldMinimumWidth = font.measureTextRange('-2147483648', 0, 11) + font.advance(' ') + 6;
		const outlineMinimumWidth = font.charAdvance * 14 + indent * 2 + SCROLLBAR_WIDTH + PADDING * 2;
		const mapMinimumWidth = Math.max(measureCartMapGrid(font).minimumWidth, fieldMinimumWidth + axisLabelWidth + PADDING) + PADDING * 2;
		measured = { axisLabelWidth, fieldMinimumWidth, outlineMinimumWidth, mapMinimumWidth, splitMinimumWidth: outlineMinimumWidth + mapMinimumWidth + 1 };
		measurements.set(font, measured);
	}
	return measured;
}

/** Current-font constraints are independent of the input's last arranged pixel cache. */
export function measureCartMapMinimumWidth(input: CartMapInput, font: EditorFont = editorViewState.font): number {
	const measured = measureCartMap(font);
	return input.section === 'map' ? measured.mapMinimumWidth : measured.outlineMinimumWidth;
}

export function measureCartMapEditor(input: CartMapInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0;
	target.companionWidth = companionRequested ? measureCartMapMinimumWidth(input, font) : undefined;
}

/** A split exists only while both clients fit their measured reading/editing budget. */
export function layoutCartMap(input: CartMapInput, bounds: Readonly<RectBounds>, changed: boolean,
	beforeModeChange?: (mode: CartMapLayoutMode) => void, beforeFieldHide?: (axis: number) => void): boolean {
	const resized = updateFullWidthWorkbenchLayout(input.layout, bounds), { layout, tree, grid } = input;
	const font = editorViewState.font, row = layout.rowHeight + PADDING;
	const indent = resized ? Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2) : tree.layout.indentWidth;
	if (layout.minimumFont !== font) {
		const measured = measureCartMap(font);
		layout.minimumFont = font; layout.axisLabelWidth = measured.axisLabelWidth; layout.fieldMinimumWidth = measured.fieldMinimumWidth;
		layout.outlineMinimumWidth = measured.outlineMinimumWidth; layout.mapMinimumWidth = measured.mapMinimumWidth; layout.splitMinimumWidth = measured.splitMinimumWidth;
	}
	const width = layout.right - layout.left;
	const mode = width >= layout.splitMinimumWidth ? 'split' : input.section;
	const modeChanged = mode !== layout.mode, measured = resized || changed || modeChanged;
	if (modeChanged) beforeModeChange?.(mode);
	layout.mode = mode;
	if (measured) {
		const contentTop = Math.min(layout.bottom, layout.top + row * 2);
		layout.gridLeft = mode === 'split' ? layout.left + clamp(Math.trunc(width * 0.32),
			layout.outlineMinimumWidth, width - layout.mapMinimumWidth - 1) + 1 : layout.left;
		if (mode === 'map') tree.updateLayout(layout.left + PADDING, contentTop, layout.left + PADDING + SCROLLBAR_WIDTH, contentTop, row, indent);
		else tree.updateLayout(layout.left + PADDING, contentTop,
			(mode === 'split' ? layout.gridLeft - 1 : layout.right) - PADDING, layout.bottom, row, indent);
		for (const item of input.actionBar.items) {
			if (item.command === 'cartMap.map') item.visible = mode === 'outline';
			else if (item.command === 'cartMap.outline') item.visible = mode === 'map';
		}
		layoutWorkbenchActionBar(input.actionBar, layout.right - PADDING, layout.top, layout.top + row,
			measureText, font.renderFont(), layout.left + PADDING);
		if (resized || modeChanged || layout.sourceVersion !== input.version) {
			const textWidth = tree.layout.contentRight - tree.layout.contentLeft - tree.layout.twistieWidth;
			for (const root of tree.roots) {
				root.element.displayLabel = truncateTextToWidth(root.element.label, textWidth);
				for (const child of root.children) child.element.displayLabel = truncateTextToWidth(child.element.label,
					textWidth - child.depth * tree.layout.indentWidth);
			}
			layout.sourceTitle = truncateTextToWidth(input.sourceCaption, input.actionBar.bounds.left - layout.left - PADDING * 2);
			write_rect_bounds(layout.sourceBounds, layout.left + PADDING, layout.top,
				Math.max(layout.left + PADDING, input.actionBar.bounds.left - PADDING), Math.min(layout.bottom, layout.top + row));
			layout.outlineTitle = mode === 'map' ? '' : input.mapKind === 'pietious' ? 'Rooms' : 'Markers';
			layout.sourceVersion = input.version;
		}
		const element = tree.rows[tree.selectionIndex]?.element;
		const subject = element === undefined ? tree.roots.find(root => root.element.sheet === grid.content)?.element : element;
		layout.selectionLabel = subject === undefined ? '' : subject.label;
		layout.selectionTitle = mode === 'outline' ? '' : truncateTextToWidth(layout.selectionLabel, layout.right - layout.gridLeft - PADDING * 2);
		write_rect_bounds(layout.selectionBounds, layout.gridLeft + PADDING, Math.min(layout.bottom, layout.top + row),
			mode === 'outline' ? layout.gridLeft + PADDING : layout.right - PADDING, contentTop);
		const left = layout.gridLeft + PADDING, right = layout.right - PADDING;
		const fields = mode !== 'outline' && input.selected !== undefined;
		const labelWidth = layout.axisLabelWidth + PADDING;
		const inline = right - left >= (layout.fieldMinimumWidth + labelWidth) * 2 + PADDING;
		const stride = inline ? Math.trunc((right - left - PADDING) / 2) : right - left;
		for (let axis = 0; axis < input.fieldBounds.length; axis++) {
			const top = Math.min(layout.bottom, contentTop + (inline ? 0 : axis * row));
			const fieldLeft = left + (inline ? axis * (stride + PADDING) : 0) + labelWidth;
			const fieldRight = fields ? Math.max(fieldLeft, left + (inline ? axis * (stride + PADDING) + stride : stride)) : fieldLeft;
			const bottom = fields ? Math.min(layout.bottom, top + row) : top;
			const previous = input.fieldBounds[axis];
			if (previous.bottom > previous.top && previous.right > previous.left && (bottom === top || fieldRight === fieldLeft)) beforeFieldHide?.(axis);
			write_rect_bounds(previous, fieldLeft, top, fieldRight, bottom);
		}
		const gridTop = fields ? Math.min(layout.bottom, contentTop + row * (inline ? 1 : 2) + PADDING) : contentTop;
		grid.layout(left, gridTop, mode === 'outline' ? left : right, mode === 'outline' ? gridTop : layout.bottom);
	}
	if (input.restoredTreeScroll !== undefined && mode !== 'map' && tree.layout.visibleRowCount > 0) {
		tree.scroll = input.restoredTreeScroll;
		input.restoredTreeScroll = undefined;
	}
	return measured;
}
