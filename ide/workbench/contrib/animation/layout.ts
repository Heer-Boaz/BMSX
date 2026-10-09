import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { truncateMeasuredText } from '../../../common/text';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { clampWorkbenchListScroll, layoutWorkbenchList } from '../../ui/list_view';
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
import type { AnimationEditorInput } from './editor_input';
import type { AnimationKeyControl } from './key_control';

/** Layout is retained by the pane on source, font or bounds changes. */
export function layoutAnimationEditor(input: AnimationEditorInput, bounds: Readonly<RectBounds>, keys: AnimationKeyControl): void {
	const { font } = editorViewState;
	const rowHeight = font.lineHeight + 4;
	const listRight = bounds.left + Math.round((bounds.right - bounds.left) * 0.38);
	const top = bounds.top + rowHeight + 6;
	layoutWorkbenchActionBar(input.actionBar, bounds.right - 4, bounds.top, bounds.top + rowHeight, measureText, font.renderFont());
	layoutWorkbenchList(input.tracks.layout, bounds.left + 4, top, listRight - 4, bounds.bottom - 4, rowHeight);
	clampWorkbenchListScroll(input.tracks);
	for (const row of input.tracks.rows) row.text = truncateMeasuredText(row.label, listRight - bounds.left - 12, measureTextRange);
	keys.layout(listRight + 8, top + rowHeight, bounds.right - 8, top + rowHeight * 3);
	layoutWorkbenchPropertyTree(input.details, font.renderFont(), measureTextRange, listRight + 4,
		input.keys.track === undefined ? top : top + rowHeight * 5, bounds.right - 4, bounds.bottom);
}
