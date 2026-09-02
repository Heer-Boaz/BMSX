import type { RectBounds } from '../../../machine/ts/common/rect';
import { create_rect_bounds } from '../../../machine/ts/common/rect';
import type { TopBarButtonId } from '../../common/commands';
import type { EditorTabId } from './tab/id';
import type { TabDragState } from './tab/model';
import type { MenuId } from './top_bar/menu';

type EditorChromeState = {
	topBarBounds: RectBounds;
	topBarButtonBounds: Record<TopBarButtonId, RectBounds>;
	menuEntryBounds: Record<MenuId, RectBounds>;
	menuDropdownBounds: RectBounds;
	tabBarBounds: RectBounds;
	openMenuId: MenuId | null;
	tabButtonBounds: Map<EditorTabId, RectBounds>;
	tabCloseButtonBounds: Map<EditorTabId, RectBounds>;
	tabHoverId: EditorTabId | null;
	tabDragState: TabDragState | null;
	problemsPanelResizing: boolean;
	resourcePanelResizing: boolean;
};

export const editorChromeState: EditorChromeState = {
	topBarBounds: create_rect_bounds(),
	topBarButtonBounds: {
		"hot-resume": create_rect_bounds(),
		debugContinue: create_rect_bounds(),
		debugStepInto: create_rect_bounds(),
		debugStepOut: create_rect_bounds(),
		debugStepOver: create_rect_bounds(),
		reboot: create_rect_bounds(),
		save: create_rect_bounds(),
		resources: create_rect_bounds(),
		problems: create_rect_bounds(),
		behaviorLens: create_rect_bounds(),
		filter: create_rect_bounds(),
		wrap: create_rect_bounds(),
	},
	menuEntryBounds: {
		file: create_rect_bounds(),
		run: create_rect_bounds(),
		view: create_rect_bounds(),
	},
	menuDropdownBounds: null,
	tabBarBounds: create_rect_bounds(),
	openMenuId: null,
	tabButtonBounds: new Map<EditorTabId, RectBounds>(),
	tabCloseButtonBounds: new Map<EditorTabId, RectBounds>(),
	tabHoverId: null,
	tabDragState: null,
	problemsPanelResizing: false,
	resourcePanelResizing: false,
};
