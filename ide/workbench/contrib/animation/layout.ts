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
	const listRight = bounds.left + Math.round((bounds.right - bounds.left) * 0.32);
	const top = bounds.top + rowHeight + 6;
	const overviewBottom = top + Math.max(rowHeight * 3, Math.round((bounds.bottom - top) * 0.35));
	for (const item of input.actionBar.items) {
		if (item.command === 'animation.addFrame') item.visible = input.document?.family === 'sprite';
		else if (item.command === 'animation.addTrack' || item.command === 'animation.addKey') item.visible = input.document?.family === 'timeline';
	}
	layoutWorkbenchActionBar(input.actionBar, bounds.right - 4, bounds.top, bounds.top + rowHeight, measureText, font.renderFont(), bounds.left + 4);
	layoutWorkbenchList(input.tracks.layout, bounds.left + 4, top, listRight - 4, overviewBottom, rowHeight);
	input.overview.layout(listRight + 8, top, bounds.right - 8, overviewBottom);
	clampWorkbenchListScroll(input.tracks);
	for (const row of input.tracks.rows) row.text = truncateMeasuredText(row.label, listRight - bounds.left - 12, measureTextRange);
	keys.layout(listRight + 8, overviewBottom + rowHeight, bounds.right - 8, overviewBottom + rowHeight * 2);
	input.keys.curve.layout(listRight + 8, overviewBottom + rowHeight * 4, bounds.right - 8, bounds.bottom - 8);
	layoutWorkbenchPropertyTree(input.details, font.renderFont(), measureTextRange, bounds.left + 4,
		overviewBottom + 4, listRight - 4, bounds.bottom);
}
