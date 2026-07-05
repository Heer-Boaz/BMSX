import { machineManager } from '../../../../core/machine_manager';
import { showEditorMessage } from '../../../common/feedback_state';
import * as constants from '../../../common/constants';
import type { ResourceDescriptor } from '../../../common/models';
import { prepareEditorForSourceFocus, releaseResourcePanelFocus } from '../../../navigation/source_focus';
import { findResourceDescriptorForChunk } from './lookup';
import { openResourceViewerTab } from './view_tabs';
import { openCodeTabForDescriptor } from '../../ui/code_tab/io';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function openResourceDescriptor(descriptor: ResourceDescriptor): void {
	const resourcePanel = machineManager.ideState.editor.resourcePanel;
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
		void openCodeTabForDescriptor(descriptor);
	} else {
		openResourceViewerTab(descriptor);
	}
	releaseResourcePanelFocus(resourcePanel);
}

export function focusChunkSource(runtime: Runtime, path: string): void {
	prepareEditorForSourceFocus(runtime);
	if (!path) {
		return;
	}
	const descriptor = findResourceDescriptorForChunk(path);
	if (!descriptor) {
		return;
	}
	openResourceDescriptor(descriptor);
}
