import type { RectBounds } from '../../../rompack/format';
import { create_rect_bounds } from '../../../common/rect';
import type { MenuId, TopBarButtonId } from '../../common/models';

type EditorChromeState = {
	topBarButtonBounds: Record<TopBarButtonId, RectBounds>;
	menuEntryBounds: Record<MenuId, RectBounds>;
	menuDropdownBounds: RectBounds;
	openMenuId: MenuId;
	tabButtonBounds: Map<string, RectBounds>;
	tabCloseButtonBounds: Map<string, RectBounds>;
	problemsPanelResizing: boolean;
	resourcePanelResizing: boolean;
};

export const editorChromeState: EditorChromeState = {
	topBarButtonBounds: {
		"hot-resume": create_rect_bounds(),
		reboot: create_rect_bounds(),
		save: create_rect_bounds(),
		resources: create_rect_bounds(),
		problems: create_rect_bounds(),
		filter: create_rect_bounds(),
		wrap: create_rect_bounds(),
		debugContinue: create_rect_bounds(),
		debugStepOver: create_rect_bounds(),
		debugStepInto: create_rect_bounds(),
		debugStepOut: create_rect_bounds(),
	},
	menuEntryBounds: {
		file: create_rect_bounds(),
		run: create_rect_bounds(),
		view: create_rect_bounds(),
		debug: create_rect_bounds(),
	},
	menuDropdownBounds: null,
	openMenuId: null,
	tabButtonBounds: new Map<string, RectBounds>(),
	tabCloseButtonBounds: new Map<string, RectBounds>(),
	problemsPanelResizing: false,
	resourcePanelResizing: false,
};
