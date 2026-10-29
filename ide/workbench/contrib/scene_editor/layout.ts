import { clamp } from '../../../../machine/ts/common/clamp';
import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorFont } from '../../../editor/ui/view/font';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { getWorkbenchEditorBounds, updateFullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import { layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, WORKBENCH_ACTION_BAR_ITEM_SPACING } from '../../ui/action_bar';
import type { SceneEditorInput } from './editor_input';
import type { SceneEditorViewState } from './view_state';

const PADDING = 4;
const CLIENT_READING_COLUMNS = 24;

export function measureSceneEditorMinimumWidth(font: EditorFont = editorViewState.font): number {
	return font.charAdvance * CLIENT_READING_COLUMNS + PADDING * 2 + SCROLLBAR_WIDTH;
}
export function measureSceneEditor(_input: SceneEditorInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0;
	target.companionWidth = companionRequested ? measureSceneEditorMinimumWidth(font) : undefined;
}

/** Allocate actual sibling clients; their own layout owners measure and project content. */
export function layoutSceneEditor(input: SceneEditorViewState, contentChanged: boolean, selectionChanged = false,
	bounds: Readonly<RectBounds> = getWorkbenchEditorBounds()): boolean {
	const changed = updateFullWidthWorkbenchLayout(input.layout, bounds), layout = input.layout;
	if (changed) layout.splitMinimumWidth = 2 * measureSceneEditorMinimumWidth() + 1;
	const mode = layout.right - layout.left >= layout.splitMinimumWidth ? 'split' : input.section;
	const measured = changed || contentChanged || selectionChanged || mode !== layout.mode;
	layout.mode = mode;
	if (!measured) return false;
	const rowHeight = layout.rowHeight + PADDING;
	layout.detailsLeft = mode === 'split' ? layout.left + ((layout.right - layout.left) >> 1) : layout.left;
	const contentTop = Math.min(layout.bottom, layout.top + rowHeight * 2);
	write_rect_bounds(layout.hierarchyBounds, layout.left, contentTop,
		mode === 'details' ? layout.left : mode === 'split' ? layout.detailsLeft : layout.right,
		mode === 'details' ? contentTop : layout.bottom);
	write_rect_bounds(layout.detailsBounds, layout.detailsLeft, contentTop,
		mode === 'outline' ? layout.detailsLeft : layout.right, mode === 'outline' ? contentTop : layout.bottom);
	const iconWidth = Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, rowHeight);
	const actionWidth = mode === 'split' ? iconWidth : iconWidth * 2 + WORKBENCH_ACTION_BAR_ITEM_SPACING;
	const left = clamp(layout.left + PADDING, layout.left, layout.right), right = clamp(layout.right - PADDING, left, layout.right);
	const actionLeft = clamp(layout.left + measureText(input.sourceCaption) + PADDING * 3, left, Math.max(left, right - actionWidth));
	const actionBottom = Math.min(layout.bottom, layout.top + rowHeight);
	layoutWorkbenchActionBar(input.actionBar, right, layout.top, actionBottom, measureText, editorViewState.font.renderFont(), actionLeft);
	input.sourceText = truncateTextToWidth(input.sourceCaption, input.actionBar.bounds.left - layout.left - PADDING * 2);
	write_rect_bounds(layout.sourceBounds, left, layout.top, Math.max(left, input.actionBar.bounds.left - PADDING), actionBottom);
	layout.outlineTitle = mode === 'details' ? '' : 'Scenes';
	layout.detailsTitle = mode === 'outline' ? '' : 'Details';
	return true;
}
