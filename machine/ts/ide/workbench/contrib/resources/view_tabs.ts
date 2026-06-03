import type { ResourceDescriptor } from '../../../../rompack/tooling/resource';
import type { EditorTabId, ResourceViewerState } from '../../../common/models';
import { setActiveTab } from '../../ui/tabs';
import { tabSessionState } from '../../ui/tab/session_state';
import { buildResourceViewerState } from './viewer';
import type { Runtime } from '../../../../machine/runtime/runtime';

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

export function openResourceViewerTab(runtime: Runtime, descriptor: ResourceDescriptor): void {
	const tabId: EditorTabId = `resource:${descriptor.path}`;
	let tab = null;
	for (let index = 0; index < tabSessionState.tabs.length; index += 1) {
		const candidate = tabSessionState.tabs[index];
		if (candidate.id === tabId) {
			tab = candidate;
			break;
		}
	}
	const state = buildResourceViewerState(runtime, descriptor);
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
