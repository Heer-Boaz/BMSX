import { resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { EditorTabId, ResourceViewerState } from '../../../common/models';
import { setActiveTab } from '../../ui/tabs';
import { tabSessionState } from '../../ui/tab/session_state';
import { buildResourceViewerState } from './viewer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourcePanelController } from './panel/controller';

export function getActiveResourceViewer(): ResourceViewerState {
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const tab = tabSessionState.tabs[index];
		if (tab.id !== tabSessionState.activeTabId) {
			continue;
		}
		return tab.kind === 'resource_view' ? tab.resource : null;
	}
	return null;
}

export function openResourceViewerTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): void {
	const tabId: EditorTabId = `resource:${resourceIdentityKey(resource)}`;
	let tab = null;
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const candidate = tabSessionState.tabs[index];
		if (candidate.id === tabId) {
			tab = candidate;
			break;
		}
	}
	const state = buildResourceViewerState(sources, resource);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		tab.dirty = false;
		setActiveTab(resourcePanel, tabId);
		return;
	}
	tab = {
		id: tabId,
		kind: 'resource_view',
		title: state.title,
		closable: true,
		dirty: false,
		resource: state,
	};
	tabSessionState.tabs.push(tab);
	setActiveTab(resourcePanel, tabId);
}
