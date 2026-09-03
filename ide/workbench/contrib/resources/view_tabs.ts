import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { buildResourceViewerState } from './viewer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceViewerState } from './model';
import { ResourceViewerInput } from './editor_input';

export function getActiveResourceViewer(): ResourceViewerState | null {
	const tab = editorTabGroup.activeTab;
	return tab.kind === 'resource_view' ? tab.resource : null;
}

export function retainResourceViewerInput(
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): ResourceViewerInput {
	const tabId: ResourceViewerTabId = `resource:${resourceIdentityKey(resource)}`;
	let tab = editorTabGroup.findById(tabId);
	const state = buildResourceViewerState(sources, resource);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		return tab;
	}
	tab = new ResourceViewerInput(state);
	editorTabGroup.add(tab);
	return tab;
}
