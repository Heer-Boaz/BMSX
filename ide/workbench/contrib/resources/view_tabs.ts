import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { ResourceViewerTabId } from '../../ui/tab/id';
import { setActiveTab } from '../../ui/tabs';
import { editorTabGroup } from '../../ui/tab/group_model';
import { buildResourceViewerState } from './viewer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourcePanelController } from './panel/controller';
import type { ResourceViewerState } from './model';

export function getActiveResourceViewer(): ResourceViewerState | null {
	const tab = editorTabGroup.activeTab;
	return tab.kind === 'resource_view' ? tab.resource : null;
}

export function openResourceViewerTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): void {
	const tabId: ResourceViewerTabId = `resource:${resourceIdentityKey(resource)}`;
	let tab = editorTabGroup.findById(tabId);
	const state = buildResourceViewerState(sources, resource);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		setActiveTab(resourcePanel, tabId);
		return;
	}
	tab = {
		id: tabId,
		kind: 'resource_view',
		title: state.title,
		closable: true,
		resource: state,
	};
	editorTabGroup.add(tab);
	setActiveTab(resourcePanel, tabId);
}
