import { Scrollbar } from './scrollbar';
import { ScrollbarPointerControl } from './scrollbar_pointer';
import { pointerCapture } from '../../input/pointer/capture';
import type { RectBounds } from '../../../machine/ts/common/rect';
import { create_rect_bounds } from '../../../machine/ts/common/rect';
import type { EditorTabId } from './tab/id';
import type { TabDragState } from './tab/model';
import type { MenuId } from './top_bar/menu';
import { createWorkbenchActionBar, type WorkbenchActionBarState } from './action_bar';

type EditorChromeState = {
	topBarBounds: RectBounds;
	runtimeTimelineHeight: number;
	menuEntryBounds: Record<MenuId, RectBounds>;
	menuDropdownBounds: RectBounds;
	tabBarBounds: RectBounds;
	tabViewportBounds: RectBounds;
	tabActions: WorkbenchActionBarState;
	tabScrollbar: Scrollbar;
	tabScrollControl: ScrollbarPointerControl;
	openMenuId: MenuId | null;
	tabButtonBounds: Map<EditorTabId, RectBounds>;
	tabCloseButtonBounds: Map<EditorTabId, RectBounds>;
	tabHoverId: EditorTabId | null;
	tabDragState: TabDragState | null;
	lastTabClickId: EditorTabId | null;
	lastTabClickTime: number;
	problemsPanelResizing: boolean;
	resourcePanelResizing: boolean;
};

const tabScrollbar = new Scrollbar('horizontal');

export const editorChromeState: EditorChromeState = {
	topBarBounds: create_rect_bounds(),
	runtimeTimelineHeight: 0,
	menuEntryBounds: {
		file: create_rect_bounds(),
		edit: create_rect_bounds(),
		run: create_rect_bounds(),
		view: create_rect_bounds(),
	},
	menuDropdownBounds: null,
	tabBarBounds: create_rect_bounds(),
	tabViewportBounds: create_rect_bounds(),
	tabActions: createWorkbenchActionBar('editorTabs.title'),
	tabScrollbar,
	tabScrollControl: new ScrollbarPointerControl(pointerCapture),
	openMenuId: null,
	tabButtonBounds: new Map<EditorTabId, RectBounds>(),
	tabCloseButtonBounds: new Map<EditorTabId, RectBounds>(),
	tabHoverId: null,
	tabDragState: null,
	lastTabClickId: null,
	lastTabClickTime: 0,
	problemsPanelResizing: false,
	resourcePanelResizing: false,
};
