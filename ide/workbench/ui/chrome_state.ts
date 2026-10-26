import type { RectBounds } from '../../../machine/ts/common/rect';
import { create_rect_bounds } from '../../../machine/ts/common/rect';
import type { MenuId } from './top_bar/menu';

type EditorChromeState = {
	topBarBounds: RectBounds;
	menuButtonBounds: RectBounds;
	menuBarHeight: number;
	runtimeTimelineHeight: number;
	editorRightInset: number;
	menuEntryBounds: Record<MenuId, RectBounds>;
};

export const editorChromeState: EditorChromeState = {
	topBarBounds: create_rect_bounds(),
	menuButtonBounds: create_rect_bounds(),
	menuBarHeight: 0,
	runtimeTimelineHeight: 0,
	editorRightInset: 0,
	menuEntryBounds: {
		file: create_rect_bounds(),
		edit: create_rect_bounds(),
		run: create_rect_bounds(),
		view: create_rect_bounds(),
		tools: create_rect_bounds(),
	},
};
