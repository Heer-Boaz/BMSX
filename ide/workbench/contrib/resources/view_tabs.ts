import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { buildResourceViewerContent } from './viewer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceViewerState } from './model';
import { ResourceViewerInput } from './editor_input';

export function getActiveResourceViewer(): ResourceViewerState | null {
	const tab = editorTabGroup.activeTab;
	return tab.kind === 'resource_view' ? tab.view : null;
}

export function resolveResourceViewerInput(
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): ResourceViewerInput {
	const tabId: ResourceViewerTabId = `resource:${resourceIdentityKey(resource)}`;
	const tab = editorTabGroup.findById(tabId);
	const content = buildResourceViewerContent(sources, resource);
	if (tab !== undefined) {
		tab.updateContent(content);
		return tab;
	}
	return new ResourceViewerInput(content);
}
