import type { CartEditor } from '../../../cart_editor';
import type { RuntimeResource } from '../../../common/models';
import { prepareEditorForSourceFocus, releaseResourcePanelFocus } from '../../../navigation/source_focus';
import { openResourceViewerTab } from './view_tabs';
import { openCodeTabForResource } from '../../ui/code_tab/io';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import {
	resolveRuntimeResource,
	resolveRuntimeResourceForContext,
} from '../../../runtime/sources';
import type { RuntimeSourceState } from '../../../runtime/sources';

export function openResource(
	editor: CartEditor,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): void {
	const resourcePanel = editor.resourcePanel;
	resourcePanel.queuePendingSelection(resource);
	if (resourcePanel.isVisible()) {
		resourcePanel.applyPendingSelection();
	}
	if (resource.source.type === 'lua' || resource.source.type === 'aem') {
		void openCodeTabForResource(resourcePanel, sources, resource);
	} else {
		openResourceViewerTab(resourcePanel, sources, resource);
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
	const resource = resolveRuntimeResource(sources, identity);
	if (!resource) {
		return;
	}
	openResource(editor, sources, resource);
}

export function focusChunkSourceForContext(
	editor: CartEditor,
	sources: RuntimeSourceState,
	domain: ResourceDomain,
	path: string,
): ResourceIdentity | null {
	const resource = resolveRuntimeResourceForContext(sources, domain, path);
	if (!resource) {
		return null;
	}
	focusChunkSource(editor, sources, resource);
	return resource;
}
