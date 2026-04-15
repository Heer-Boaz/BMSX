import { editorRuntimeState } from '../../editor/common/editor_runtime_state';
import { editorChromeState } from './chrome_state';
import { editorDiagnosticsState } from '../../editor/contrib/diagnostics/diagnostics_state';
import { editorViewState } from '../../editor/ui/editor_view_state';
import type { CodeTabContext, EditorTabDescriptor, EditorTabKind } from '../../common/types';
import { beginNavigationCapture, completeNavigation } from '../../editor/navigation/navigation_history';
import { closeLineJump } from '../../editor/contrib/find/line_jump';
import { closeSymbolSearch } from '../../editor/contrib/symbols/symbol_search_shared';
import { getCodeAreaBounds, hideResourcePanel } from '../../editor/ui/editor_view';
import { closeSearch } from '../../editor/contrib/find/editor_search';
import { clampResourceViewerScroll } from '../contrib/resources/resource_viewer';
import { editorPointerState } from '../../editor/input/pointer/editor_pointer_state';
import { runtimeErrorState } from '../../editor/contrib/runtime_error/runtime_error_state';
import { editorCaretState } from '../../editor/ui/caret_state';
import {
	createEntryTabContext,
	upsertCodeEditorTab,
} from './code_tab_contexts';
import { activateCodeEditorTab, storeActiveCodeTabContext } from './code_tab_activation';
import { endTabDrag } from './tab_drag';
import { codeTabSessionState } from './code_tab_session_state';
import { tabSessionState } from './tab_session_state';

function activateResourceViewerTab(tab: EditorTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	editorCaretState.cursorRevealSuspended = false;
	tab.dirty = false;
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

export function setActiveTab(tabId: string): void {
	const tab = tabSessionState.tabs.find(candidate => candidate.id === tabId)!;
	const isSameTab = tabSessionState.activeTabId === tabId;
	const navigationCheckpoint = !isSameTab && tab.kind === 'code_editor'
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	if (!isSameTab && getActiveTabKind() === 'code_editor') {
		storeActiveCodeTabContext();
	}
	if (isSameTab) {
		if (tab.kind === 'resource_view') {
			codeTabSessionState.activeContextReadOnly = false;
			activateResourceViewerTab(tab);
			runtimeErrorState.activeOverlay = null;
			runtimeErrorState.executionStopRow = null;
		}
		return;
	}
	tabSessionState.activeTabId = tabId;
	if (tab.kind === 'resource_view') {
		codeTabSessionState.activeContextReadOnly = false;
		activateResourceViewerTab(tab);
		runtimeErrorState.activeOverlay = null;
		runtimeErrorState.executionStopRow = null;
		return;
	}
	hideResourcePanel();
	activateCodeEditorTab(tab.id);
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
