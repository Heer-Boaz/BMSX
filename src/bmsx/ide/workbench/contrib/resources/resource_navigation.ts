import { editorRuntimeState } from '../../../editor/common/editor_runtime_state';
import { showEditorMessage } from '../../common/feedback_state';
import * as constants from '../../../common/constants';
import { Runtime } from '../../../../emulator/runtime';
import * as runtimeIde from '../../../../emulator/runtime_ide';
import type { ResourceDescriptor } from '../../../common/types';
import { closeLineJump } from '../../../editor/contrib/find/line_jump';
import { closeSymbolSearch } from '../../../editor/contrib/symbols/symbol_search_shared';
import { closeSearch } from '../../../editor/contrib/find/editor_search';
import { resetBlink } from '../../../editor/render/render_caret';
import { selectResourceInPanel } from '../../../editor/ui/editor_view';
import { closeResourceSearch } from './resource_search';
import { findResourceDescriptorForChunk } from './resource_lookup';
import { openResourceViewerTab } from './resource_viewer';
import { resourcePanel } from './resource_panel_controller';
import { openCodeTabForDescriptor } from '../../ui/code_tab_io';

export function focusEditorFromResourcePanel(): void {
	if (!resourcePanel.isFocused()) {
		return;
	}
	resourcePanel.setFocused(false);
	resetBlink();
}

export function openResourceDescriptor(descriptor: ResourceDescriptor): void {
	selectResourceInPanel(descriptor);
	if (descriptor.type === 'atlas') {
		showEditorMessage('Atlas resources cannot be previewed in the IDE.', constants.COLOR_STATUS_WARNING, 3.2);
		focusEditorFromResourcePanel();
		return;
	}
	if (descriptor.type === 'lua' || descriptor.type === 'aem') {
		void openCodeTabForDescriptor(descriptor);
	} else {
		openResourceViewerTab(descriptor);
	}
	focusEditorFromResourcePanel();
}

export function focusChunkSource(path: string): void {
	if (!editorRuntimeState.active) {
		runtimeIde.activateEditor(Runtime.instance);
	}
	closeSymbolSearch(true);
	closeResourceSearch(true);
	closeLineJump(true);
	closeSearch(true);
	if (!path) {
		return;
	}
	const descriptor = findResourceDescriptorForChunk(path);
	if (!descriptor) {
		return;
	}
	openResourceDescriptor(descriptor);
}
