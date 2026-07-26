import type { CartEditor } from '../../../cart_editor';
import type { ResourceDescriptor } from '../../../common/models';
import { prepareEditorForSourceFocus, releaseResourcePanelFocus } from '../../../navigation/source_focus';
import { findResourceDescriptorForChunk } from './lookup';
import { openResourceViewerTab } from './view_tabs';
import { openCodeTabForDescriptor } from '../../ui/code_tab/io';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import { resolveRuntimeLuaSourceForContext } from '../../../runtime/sources';
import type { RuntimeSourceState } from '../../../runtime/sources';

export function openResourceDescriptor(
	editor: CartEditor,
	sources: RuntimeSourceState,
	descriptor: ResourceDescriptor,
): void {
	const resourcePanel = editor.resourcePanel;
	if (descriptor.asset_id && descriptor.asset_id.length > 0) {
		resourcePanel.queuePendingSelection(descriptor);
		if (resourcePanel.isVisible()) {
			resourcePanel.applyPendingSelection();
		}
	}
	if (descriptor.type === 'lua' || descriptor.type === 'aem') {
		void openCodeTabForDescriptor(resourcePanel, sources, descriptor);
	} else {
		openResourceViewerTab(resourcePanel, sources, descriptor);
	}
	releaseResourcePanelFocus(resourcePanel);
}

export function focusChunkSource(
	editor: CartEditor,
	sources: RuntimeSourceState,
	identity: ResourceIdentity,
): void {
	prepareEditorForSourceFocus();
	if (!identity.path) {
		return;
	}
	const descriptor = findResourceDescriptorForChunk(sources, identity);
	if (!descriptor) {
		return;
	}
	openResourceDescriptor(editor, sources, descriptor);
}

export function focusChunkSourceForContext(
	editor: CartEditor,
	sources: RuntimeSourceState,
	domain: ResourceDomain,
	path: string,
): ResourceIdentity | null {
	const source = resolveRuntimeLuaSourceForContext(sources, domain, path);
	if (!source) {
		return null;
	}
	const identity = { domain: source.domain, path: source.record.source_path };
	focusChunkSource(editor, sources, identity);
	return identity;
}
