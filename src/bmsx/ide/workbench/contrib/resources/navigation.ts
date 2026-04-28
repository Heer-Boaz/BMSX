import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { showEditorMessage } from '../../../common/feedback_state';
import * as constants from '../../../common/constants';
import * as workbenchMode from '../../mode';
import type { ResourceDescriptor } from '../../../common/models';
import { closeLineJump } from '../../../editor/contrib/find/line_jump';
import { closeSymbolSearch } from '../../../editor/contrib/symbols/shared';
import { closeSearch } from '../../../editor/contrib/find/search';
import { resetBlink } from '../../../editor/render/caret';
import { selectResourceInPanel } from '../../../editor/ui/view/view';
import { closeResourceSearch } from './search';
import { findResourceDescriptorForChunk } from './lookup';
import { openResourceViewerTab } from './view_tabs';
import { resourcePanel } from './panel/controller';
import { openCodeTabForDescriptor } from '../../ui/code_tab/io';

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
		workbenchMode.activateEditor();
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
