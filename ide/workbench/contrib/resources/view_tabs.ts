import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { buildResourceViewerState } from './viewer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceViewerState } from './model';
import type { ResourceViewerTabDescriptor } from '../../ui/tab/model';

export function getActiveResourceViewer(): ResourceViewerState | null {
	const tab = editorTabGroup.activeTab;
	return tab.kind === 'resource_view' ? tab.resource : null;
}

export function retainResourceViewerInput(
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): ResourceViewerTabDescriptor {
	const tabId: ResourceViewerTabId = `resource:${resourceIdentityKey(resource)}`;
	let tab = editorTabGroup.findById(tabId);
	const state = buildResourceViewerState(sources, resource);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		return tab;
	}
	tab = {
		id: tabId,
		kind: 'resource_view',
		title: state.title,
		closable: true,
		resource: state,
	};
	editorTabGroup.add(tab);
	return tab;
}
