import type { RectBounds } from '../../../rompack/format';
import { create_rect_bounds } from '../../../common/rect';
import type { TopBarButtonId } from '../../common/commands';
import type { TabDragState } from '../../common/models';
import type { MenuId } from './top_bar/menu';

type EditorChromeState = {
	topBarBounds: RectBounds;
	topBarButtonBounds: Record<TopBarButtonId, RectBounds>;
	menuEntryBounds: Record<MenuId, RectBounds>;
	menuDropdownBounds: RectBounds;
	tabBarBounds: RectBounds;
	openMenuId: MenuId;
	tabButtonBounds: Map<string, RectBounds>;
	tabCloseButtonBounds: Map<string, RectBounds>;
	tabHoverId: string;
	tabDragState: TabDragState;
	problemsPanelResizing: boolean;
	resourcePanelResizing: boolean;
};

export const editorChromeState: EditorChromeState = {
	topBarBounds: create_rect_bounds(),
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
	tabBarBounds: create_rect_bounds(),
	openMenuId: null,
	tabButtonBounds: new Map<string, RectBounds>(),
	tabCloseButtonBounds: new Map<string, RectBounds>(),
	tabHoverId: null,
	tabDragState: null,
	problemsPanelResizing: false,
	resourcePanelResizing: false,
};
