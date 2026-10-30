import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { updateFullWidthWorkbenchLayout, type FullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar, type WorkbenchActionBarState } from '../action_bar';

export type WorkbenchViewPanelLayout = FullWidthWorkbenchLayout & {
	readonly header: RectBounds;
	readonly titleBounds: RectBounds;
	readonly client: RectBounds;
	title: string;
	titleSource: string;
	actionRevision: number;
	headerVisible: boolean;
};
export function createWorkbenchViewPanelLayout(): WorkbenchViewPanelLayout {
	return { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		header: create_rect_bounds(), titleBounds: create_rect_bounds(), client: create_rect_bounds(), title: '', titleSource: '', actionRevision: -1, headerVisible: true };
}
export function layoutWorkbenchViewPanel(layout: WorkbenchViewPanelLayout, bounds: Readonly<RectBounds>, title: string, actions: WorkbenchActionBarState,
	headerVisible = true): boolean {
	const changed = updateFullWidthWorkbenchLayout(layout, bounds);
	if (!changed && layout.titleSource === title && layout.actionRevision === actions.presentation.revision && layout.headerVisible === headerVisible) return false;
	layout.headerVisible = headerVisible;
	const bottom = headerVisible ? Math.min(bounds.bottom, bounds.top + layout.rowHeight + 4) : bounds.top;
	write_rect_bounds(layout.header, bounds.left, bounds.top, bounds.right, bottom);
	write_rect_bounds(layout.client, bounds.left, bottom, bounds.right, Math.max(bottom, bounds.bottom));
	if (headerVisible) {
		layoutWorkbenchActionBar(actions, Math.max(bounds.left, bounds.right - 4), bounds.top, bottom,
			measureText, editorViewState.font.renderFont(), bounds.left + 4 + editorViewState.font.advance('…'));
		write_rect_bounds(layout.titleBounds, bounds.left + 4, bounds.top, Math.max(bounds.left + 4, actions.bounds.left - 4), bottom);
		layout.title = truncateTextToWidth(title, layout.titleBounds.right - layout.titleBounds.left);
	} else {
		write_rect_bounds(layout.titleBounds, bounds.left, bounds.top, bounds.left, bounds.top);
		layout.title = '';
	}
	layout.titleSource = title; layout.actionRevision = actions.presentation.revision;
	return true;
}
