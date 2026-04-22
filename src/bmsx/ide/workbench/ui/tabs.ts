// disable cross_layer_import_pattern -- workbench tabs own editor/resource tab activation lifecycle.
import { editorRuntimeState } from '../../editor/common/runtime_state';
import { editorChromeState } from './chrome_state';
import { editorDiagnosticsState } from '../../editor/contrib/diagnostics/state';
import { editorViewState } from '../../editor/ui/view/state';
import type { CodeTabContext, EditorTabDescriptor, EditorTabKind } from '../../common/models';
import { beginNavigationCapture, completeNavigation } from '../../editor/navigation/navigation_history';
import { closeLineJump } from '../../editor/contrib/find/line_jump';
import { closeSymbolSearch } from '../../editor/contrib/symbols/shared';
import { getCodeAreaBounds, hideResourcePanel } from '../../editor/ui/view/view';
import { closeSearch } from '../../editor/contrib/find/search';
import { clampResourceViewerScroll } from '../contrib/resources/viewer';
import { editorPointerState } from '../../editor/input/pointer/state';
import { runtimeErrorState } from '../../editor/contrib/runtime_error/state';
import { editorCaretState } from '../../editor/ui/view/caret/state';
import {
	createEntryTabContext,
	upsertCodeEditorTab,
} from './code_tab/contexts';
import { activateCodeEditorTab, applyActiveCodeTabSelection, storeActiveCodeTabContext, type CodeTabSelection } from './code_tab/activation';
import { endTabDrag } from './tab/drag';
import { codeTabSessionState } from './code_tab/session_state';
import { tabSessionState } from './tab/session_state';

function activateResourceViewerTab(tab: EditorTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	editorCaretState.cursorRevealSuspended = false;
	codeTabSessionState.activeContextReadOnly = false;
	tab.dirty = false;
	runtimeErrorState.activeOverlay = null;
	runtimeErrorState.executionStopRow = null;
	if (!tab.resource) {
		return;
	}
	clampResourceViewerScroll(tab.resource, getCodeAreaBounds(), editorViewState.lineHeight);
}

export function initializeTabs(initialContext: CodeTabContext = null): void {
	tabSessionState.tabs = [];
	editorPointerState.tabHoverId = null;
	editorPointerState.tabDragState = null;
	editorChromeState.tabButtonBounds.clear();
	editorChromeState.tabCloseButtonBounds.clear();
	const context = initialContext ?? createEntryTabContext();
	codeTabSessionState.contexts.set(context.id, context);
	upsertCodeEditorTab(context);
	tabSessionState.activeTabId = context.id;
	codeTabSessionState.activeContextId = context.id;
	activateCodeEditorTab(context.id);
}

function getActiveTabKind(): EditorTabKind {
	const active = tabSessionState.tabs.find(tab => tab.id === tabSessionState.activeTabId)!;
	return active.kind;
}

export function isResourceViewActive(): boolean {
	return getActiveTabKind() === 'resource_view';
}

export function setActiveTab(tabId: string, selection?: CodeTabSelection): void {
	const tab = tabSessionState.tabs.find(candidate => candidate.id === tabId)!;
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
	hideResourcePanel();
	activateCodeEditorTab(tab.id, selection);
	if (navigationCheckpoint) {
		completeNavigation(navigationCheckpoint);
	}
}

export function activateCodeTab(): void {
	const codeTab = tabSessionState.tabs.find(candidate => candidate.kind === 'code_editor')!;
	setActiveTab(codeTab.id);
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

export function closeTab(tabId: string): void {
	const index = tabSessionState.tabs.findIndex(tab => tab.id === tabId);
	const tab = tabSessionState.tabs[index];
	if (!tab.closable) {
		return;
	}
	if (editorPointerState.tabDragState && editorPointerState.tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const isActive = tabSessionState.activeTabId === tabId;
	if (isActive && tabSessionState.tabs.length > 1) {
		const fallback = tabSessionState.tabs[index - 1] ?? tabSessionState.tabs[index + 1];
		setActiveTab(fallback.id);
	} else if (isActive && tab.kind === 'code_editor') {
		storeActiveCodeTabContext();
	}
	tabSessionState.tabs.splice(index, 1);
	if (tab.kind === 'code_editor') {
		editorDiagnosticsState.dirtyDiagnosticContexts.delete(tab.id);
		editorDiagnosticsState.diagnosticsCache.delete(tab.id);
	}
	if (tabSessionState.tabs.length === 0) {
		initializeTabs();
	}
}

export function cycleTab(direction: number): void {
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
	setActiveTab(target.id);
}

export function isActive(): boolean {
	return editorRuntimeState.active;
}

export function closeActiveTab(): void {
	if (!tabSessionState.activeTabId) {
		return;
	}
	closeTab(tabSessionState.activeTabId);
}
