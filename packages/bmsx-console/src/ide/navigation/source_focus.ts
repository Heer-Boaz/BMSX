import type { Runtime } from '../../machine/runtime/runtime';
import { editorRuntimeState } from '../editor/common/runtime_state';
import { closeLineJump } from '../editor/contrib/find/line_jump';
import { closeSearch } from '../editor/contrib/find/search';
import { closeSymbolSearch } from '../editor/contrib/symbols/shared';
import { resetBlink } from '../editor/render/caret';
import type { ResourcePanelController } from '../workbench/contrib/resources/panel/controller';
import { closeResourceSearch } from '../workbench/contrib/resources/search';
import { activateEditor } from '../workbench/overlay_modes';

export function releaseResourcePanelFocus(resourcePanel: ResourcePanelController): void {
	if (!resourcePanel.isFocused()) {
		return;
	}
	resourcePanel.setFocused(false);
	resetBlink();
}

export function prepareEditorForSourceFocus(runtime: Runtime): void {
	if (!editorRuntimeState.active) {
		activateEditor(runtime);
	}
	closeSymbolSearch(true);
	closeResourceSearch(true);
	closeLineJump(true);
	closeSearch(true);
}
