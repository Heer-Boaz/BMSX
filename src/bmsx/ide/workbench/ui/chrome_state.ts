import type { RectBounds } from '../../../rompack/rompack';
import type { MenuId, TopBarButtonId } from '../../common/types';

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
		"hot-resume": { left: 0, top: 0, right: 0, bottom: 0 },
		reboot: { left: 0, top: 0, right: 0, bottom: 0 },
		save: { left: 0, top: 0, right: 0, bottom: 0 },
		resources: { left: 0, top: 0, right: 0, bottom: 0 },
		problems: { left: 0, top: 0, right: 0, bottom: 0 },
		filter: { left: 0, top: 0, right: 0, bottom: 0 },
		wrap: { left: 0, top: 0, right: 0, bottom: 0 },
		debugContinue: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepOver: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepInto: { left: 0, top: 0, right: 0, bottom: 0 },
		debugStepOut: { left: 0, top: 0, right: 0, bottom: 0 },
	},
	menuEntryBounds: {
		file: { left: 0, top: 0, right: 0, bottom: 0 },
		run: { left: 0, top: 0, right: 0, bottom: 0 },
		view: { left: 0, top: 0, right: 0, bottom: 0 },
		debug: { left: 0, top: 0, right: 0, bottom: 0 },
	},
	menuDropdownBounds: null,
	openMenuId: null,
	tabButtonBounds: new Map<string, RectBounds>(),
	tabCloseButtonBounds: new Map<string, RectBounds>(),
	problemsPanelResizing: false,
	resourcePanelResizing: false,
};
