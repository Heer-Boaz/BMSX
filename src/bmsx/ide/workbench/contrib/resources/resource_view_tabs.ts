import type { ResourceDescriptor } from '../../../../emulator/types';
import type { EditorTabId, ResourceViewerState } from '../../../common/types';
import { setActiveTab } from '../../ui/tabs';
import { tabSessionState } from '../../ui/tab_session_state';
import { buildResourceViewerState } from './resource_viewer';

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

export function openResourceViewerTab(descriptor: ResourceDescriptor): void {
	const tabId: EditorTabId = `resource:${descriptor.path}`;
	let tab = null;
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const candidate = tabSessionState.tabs[index];
		if (candidate.id === tabId) {
			tab = candidate;
			break;
		}
	}
	const state = buildResourceViewerState(descriptor);
	if (tab) {
		tab.title = state.title;
		tab.resource = state;
		tab.dirty = false;
		setActiveTab(tabId);
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
	setActiveTab(tabId);
}
