import { showEditorMessage } from '../../../common/feedback_state';
import * as constants from '../../../common/constants';
import type { ResourceDescriptor } from '../../../common/models';
import { prepareEditorForSourceFocus, releaseResourcePanelFocus } from '../../../navigation/source_focus';
import { findResourceDescriptorForChunk } from './lookup';
import { openResourceViewerTab } from './view_tabs';
import { openCodeTabForDescriptor } from '../../ui/code_tab/io';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function openResourceDescriptor(runtime: Runtime, descriptor: ResourceDescriptor): void {
	const resourcePanel = runtime.editor.resourcePanel;
	if (descriptor.asset_id && descriptor.asset_id.length > 0) {
		resourcePanel.queuePendingSelection(descriptor.asset_id);
		if (resourcePanel.isVisible()) {
			resourcePanel.applyPendingSelection();
		}
	}
	if (descriptor.type === 'atlas') {
		showEditorMessage('Atlas resources cannot be previewed in the IDE.', constants.COLOR_STATUS_WARNING, 3.2);
		releaseResourcePanelFocus(resourcePanel);
		return;
	}
	if (descriptor.type === 'lua' || descriptor.type === 'aem') {
		void openCodeTabForDescriptor(runtime, descriptor);
	} else {
		openResourceViewerTab(runtime, descriptor);
	}
	releaseResourcePanelFocus(resourcePanel);
}

export function focusChunkSource(runtime: Runtime, path: string): void {
	prepareEditorForSourceFocus(runtime);
	if (!path) {
		return;
	}
	const descriptor = findResourceDescriptorForChunk(runtime, path);
	if (!descriptor) {
		return;
	}
	openResourceDescriptor(runtime, descriptor);
}
