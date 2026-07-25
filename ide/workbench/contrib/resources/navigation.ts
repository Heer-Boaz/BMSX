import { machineManager } from '../../../../machine/ts/core/machine_manager';
import type { ResourceDescriptor } from '../../../common/models';
import { prepareEditorForSourceFocus, releaseResourcePanelFocus } from '../../../navigation/source_focus';
import { findResourceDescriptorForChunk } from './lookup';
import { openResourceViewerTab } from './view_tabs';
import { openCodeTabForDescriptor } from '../../ui/code_tab/io';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import { resolveRuntimeLuaSourceForContext } from '../../../runtime/sources';

export function openResourceDescriptor(descriptor: ResourceDescriptor): void {
	const resourcePanel = machineManager.ideState.editor.resourcePanel;
	if (descriptor.asset_id && descriptor.asset_id.length > 0) {
		resourcePanel.queuePendingSelection(descriptor);
		if (resourcePanel.isVisible()) {
			resourcePanel.applyPendingSelection();
		}
	}
	if (descriptor.type === 'lua' || descriptor.type === 'aem') {
		void openCodeTabForDescriptor(descriptor);
	} else {
		openResourceViewerTab(descriptor);
	}
	releaseResourcePanelFocus(resourcePanel);
}

export function focusChunkSource(runtime: Runtime, identity: ResourceIdentity): void {
	prepareEditorForSourceFocus(runtime);
	if (!identity.path) {
		return;
	}
	const descriptor = findResourceDescriptorForChunk(identity);
	if (!descriptor) {
		return;
	}
	openResourceDescriptor(descriptor);
}

export function focusChunkSourceForContext(
	runtime: Runtime,
	domain: ResourceDomain,
	path: string,
): ResourceIdentity | null {
	const source = resolveRuntimeLuaSourceForContext(machineManager.sourceState, domain, path);
	if (source === null) {
		return null;
	}
	const identity = { domain: source.domain, path: source.record.source_path };
	focusChunkSource(runtime, identity);
	return identity;
}
