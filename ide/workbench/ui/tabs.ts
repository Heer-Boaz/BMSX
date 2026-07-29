// disable cross_layer_import_pattern -- workbench tabs own editor/resource tab activation lifecycle.
import { editorRuntimeState } from '../../editor/common/runtime_state';
import { editorChromeState } from './chrome_state';
import { editorDiagnosticsState } from '../../editor/contrib/diagnostics/state';
import { editorViewState } from '../../editor/ui/view/state';
import type { EditorTabDescriptor, EditorTabKind } from '../../common/models';
import type { CodeTabContext } from './code_tab/model';
import { beginNavigationCapture, completeNavigation } from '../../navigation/navigation_history';
import { closeLineJump } from '../contrib/code_editor/find/line_jump';
import { closeSymbolSearch } from '../contrib/code_editor/symbols/shared';
import { getCodeAreaBounds } from '../../editor/ui/view/view';
import { closeSearch } from '../contrib/code_editor/find/search';
import { clampResourceViewerScroll } from '../contrib/resources/viewer';
import { runtimeErrorState } from '../../editor/contrib/runtime_error/state';
import { editorCaretState } from '../../editor/ui/view/caret/state';
import {
	createEntryTabContext,
	upsertCodeEditorTab,
} from './code_tab/contexts';
import { activateCodeEditorTab, applyActiveCodeTabSelection, storeActiveCodeTabContext, type CodeTabSelection } from './code_tab/activation';
import { endTabDrag } from './tab/drag';
import type { RuntimeSourceState } from '../../runtime/sources';
import { codeTabSessionState } from './code_tab/session_state';
import { tabSessionState } from './tab/session_state';
import type { ResourcePanelController } from '../contrib/resources/panel/controller';

function activateResourceViewerTab(tab: EditorTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	editorCaretState.cursorRevealSuspended = false;
	tab.dirty = false;
	runtimeErrorState.activeOverlay = null;
	runtimeErrorState.executionStopRow = null;
	if (!tab.resource) {
		return;
	}
	clampResourceViewerScroll(tab.resource, getCodeAreaBounds(), editorViewState.lineHeight);
}

export function initializeTabs(initialContext: CodeTabContext): void {
	tabSessionState.tabs = [];
	editorChromeState.tabHoverId = null;
	editorChromeState.tabDragState = null;
	editorChromeState.tabButtonBounds.clear();
	editorChromeState.tabCloseButtonBounds.clear();
	codeTabSessionState.contexts.set(initialContext.id, initialContext);
	upsertCodeEditorTab(initialContext);
	tabSessionState.activeTabId = initialContext.id;
	codeTabSessionState.activeContextId = initialContext.id;
	activateCodeEditorTab(initialContext.id);
}

function getActiveTabKind(): EditorTabKind {
	const index = tabSessionState.tabs.findIndex(tab => tab.id === tabSessionState.activeTabId);
	return tabSessionState.tabs[index].kind;
}

export function isResourceViewActive(): boolean {
	return getActiveTabKind() === 'resource_view';
}

export function setActiveTab(
	resourcePanel: ResourcePanelController,
	tabId: string,
	selection?: CodeTabSelection,
): void {
	const tabIndex = tabSessionState.tabs.findIndex(candidate => candidate.id === tabId);
	const tab = tabSessionState.tabs[tabIndex];
	const isSameTab = tabSessionState.activeTabId === tabId;
	const navigationCheckpoint = tab.kind === 'code_editor' && (!isSameTab || selection)
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	if (!isSameTab && getActiveTabKind() === 'code_editor') {
		storeActiveCodeTabContext();
	}
	if (isSameTab) {
		if (tab.kind === 'resource_view') {
			activateResourceViewerTab(tab);
		}
		if (tab.kind === 'code_editor' && selection) {
			applyActiveCodeTabSelection(selection);
			completeNavigation(navigationCheckpoint);
		}
		return;
	}
	tabSessionState.activeTabId = tabId;
	if (tab.kind === 'resource_view') {
		activateResourceViewerTab(tab);
		return;
	}
	resourcePanel.hide();
	editorChromeState.resourcePanelResizing = false;
	activateCodeEditorTab(tab.id, selection);
	if (navigationCheckpoint) {
		completeNavigation(navigationCheckpoint);
	}
}

export function activateCodeTab(resourcePanel: ResourcePanelController): void {
	const codeTabIndex = tabSessionState.tabs.findIndex(candidate => candidate.kind === 'code_editor');
	const codeTab = tabSessionState.tabs[codeTabIndex];
	setActiveTab(resourcePanel, codeTab.id);
}

export function getTabs(): readonly EditorTabDescriptor[] {
	return tabSessionState.tabs;
}

export function getActiveTabId(): string {
	return tabSessionState.activeTabId;
}

export function findTabById(tabId: string): EditorTabDescriptor | undefined {
	return tabSessionState.tabs.find(candidate => candidate.id === tabId);
}

export function isTabActive(tabId: string): boolean {
	return tabSessionState.activeTabId === tabId;
}

export function closeTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	tabId: string,
): void {
	const index = tabSessionState.tabs.findIndex(tab => tab.id === tabId);
	const tab = tabSessionState.tabs[index];
	if (!tab.closable) {
		return;
	}
	if (editorChromeState.tabDragState && editorChromeState.tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const isActive = tabSessionState.activeTabId === tabId;
	if (isActive && tabSessionState.tabs.length > 1) {
		const fallback = index > 0
			? tabSessionState.tabs[index - 1]
			: tabSessionState.tabs[index + 1];
		setActiveTab(resourcePanel, fallback.id);
	} else if (isActive && tab.kind === 'code_editor') {
		storeActiveCodeTabContext();
	}
	tabSessionState.tabs.splice(index, 1);
	if (tab.kind === 'code_editor') {
		editorDiagnosticsState.dirtyDiagnosticContexts.delete(tab.id);
		editorDiagnosticsState.diagnosticsCache.delete(tab.id);
	}
	if (tabSessionState.tabs.length === 0) {
		initializeTabs(createEntryTabContext(sources));
	}
}

export function cycleTab(resourcePanel: ResourcePanelController, direction: number): void {
	if (tabSessionState.tabs.length <= 1 || direction === 0) {
		return;
	}
	const count = tabSessionState.tabs.length;
	const currentIndex = tabSessionState.tabs.findIndex(tab => tab.id === tabSessionState.activeTabId);
	let nextIndex = currentIndex + direction;
	nextIndex = ((nextIndex % count) + count) % count;
	if (nextIndex === currentIndex) {
		return;
	}
	const target = tabSessionState.tabs[nextIndex];
	setActiveTab(resourcePanel, target.id);
}

export function isActive(): boolean {
	return editorRuntimeState.active;
}

export function closeActiveTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
): void {
	if (!tabSessionState.activeTabId) {
		return;
	}
	closeTab(resourcePanel, sources, tabSessionState.activeTabId);
}
