// disable cross_layer_import_pattern -- workbench tabs own editor/resource tab activation lifecycle.
import { editorRuntimeState } from '../../editor/common/runtime_state';
import { editorChromeState } from './chrome_state';
import { editorViewState } from '../../editor/ui/view/state';
import type { EditorTabId } from './tab/id';
import type { EditorTabDescriptor, EditorTabKind, ResourceViewerTabDescriptor } from './tab/model';
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
	createCodeEditorTabDescriptor,
	retainEntryTabContext,
} from './code_tab/contexts';
import { activateCodeEditorTab, applyActiveCodeTabSelection, storeCodeTabContext, type CodeTabSelection } from './code_tab/activation';
import { endTabDrag } from './tab/drag';
import type { RuntimeSourceState } from '../../runtime/sources';
import { editorTabGroup } from './tab/group_model';
import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import { problemsPanel } from '../contrib/problems/panel/controller';
import { closeEditorContextMenu } from '../contrib/context_menu/widget';
import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';

function activateResourceViewerTab(tab: ResourceViewerTabDescriptor): void {
	closeSearch(false, true);
	closeLineJump(false);
	editorCaretState.cursorRevealSuspended = false;
	runtimeErrorState.activeOverlay = null;
	runtimeErrorState.executionStopRow = null;
	clampResourceViewerScroll(tab.resource, getCodeAreaBounds(), editorViewState.lineHeight);
}

export function initializeTabs(initialContext: CodeTabContext): void {
	editorChromeState.tabHoverId = null;
	editorChromeState.tabDragState = null;
	editorChromeState.tabButtonBounds.clear();
	editorChromeState.tabCloseButtonBounds.clear();
	const initialTab = createCodeEditorTabDescriptor(initialContext);
	editorTabGroup.initialize(initialTab);
	activateCodeEditorTab(initialTab);
}

export function getActiveTabKind(): EditorTabKind {
	return editorTabGroup.activeTab.kind;
}

export function getActiveTab(): EditorTabDescriptor {
	return editorTabGroup.activeTab;
}

export function isResourceViewActive(): boolean {
	return getActiveTabKind() === 'resource_view';
}

export function isCodeTabActive(): boolean {
	return getActiveTabKind() === 'code_editor';
}

export function isBehaviorLensActive(): boolean {
	return getActiveTabKind() === 'behavior_lens';
}

function activateBehaviorLensTab(resourcePanel: ResourcePanelController): void {
	closeSearch(false, true);
	closeLineJump(false);
	closeEditorContextMenu();
	resourcePanel.hide();
	problemsPanel.hide();
	editorChromeState.resourcePanelResizing = false;
	editorChromeState.problemsPanelResizing = false;
	editorViewState.scrollbarController.cancel();
	editorCaretState.cursorRevealSuspended = false;
	runtimeErrorState.activeOverlay = null;
	runtimeErrorState.executionStopRow = null;
	clearGotoHoverHighlight();
	clearHoverTooltip();
}

export function setActiveTab(
	resourcePanel: ResourcePanelController,
	tabId: EditorTabId,
	selection?: CodeTabSelection,
): void {
	const tab = editorTabGroup.findById(tabId)!;
	const activeTab = editorTabGroup.activeTab;
	const isSameTab = activeTab === tab;
	const navigationCheckpoint = tab.kind === 'code_editor' && (!isSameTab || selection)
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	if (!isSameTab && activeTab.kind === 'code_editor') {
		storeCodeTabContext(activeTab.context);
	}
	if (isSameTab) {
		switch (tab.kind) {
			case 'resource_view':
				activateResourceViewerTab(tab);
				return;
			case 'behavior_lens':
				activateBehaviorLensTab(resourcePanel);
				return;
			case 'code_editor':
				if (selection) {
					applyActiveCodeTabSelection(selection);
					completeNavigation(navigationCheckpoint);
				}
				return;
		}
	}
	editorTabGroup.activate(tab);
	switch (tab.kind) {
		case 'resource_view':
			activateResourceViewerTab(tab);
			return;
		case 'behavior_lens':
			activateBehaviorLensTab(resourcePanel);
			return;
		case 'code_editor':
			resourcePanel.hide();
			editorChromeState.resourcePanelResizing = false;
			activateCodeEditorTab(tab, selection);
			if (navigationCheckpoint) {
				completeNavigation(navigationCheckpoint);
			}
			return;
	}
}

export function activateCodeTab(resourcePanel: ResourcePanelController): void {
	const tabs = editorTabGroup.tabs;
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		if (tab.kind === 'code_editor') {
			setActiveTab(resourcePanel, tab.id);
			return;
		}
	}
}

export function getTabs(): readonly EditorTabDescriptor[] {
	return editorTabGroup.tabs;
}

export function getActiveTabId(): EditorTabId {
	return editorTabGroup.activeTab.id;
}

export function findTabById(tabId: EditorTabId): EditorTabDescriptor | undefined {
	return editorTabGroup.findById(tabId);
}

export function isTabActive(tabId: EditorTabId): boolean {
	return editorTabGroup.activeTab.id === tabId;
}

export function closeTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	tabId: EditorTabId,
): void {
	const tab = editorTabGroup.findById(tabId)!;
	const index = editorTabGroup.indexOf(tab);
	if (!tab.closable) {
		return;
	}
	if (editorChromeState.tabDragState && editorChromeState.tabDragState.tabId === tabId) {
		endTabDrag();
	}
	const isActive = editorTabGroup.activeTab === tab;
	const tabs = editorTabGroup.tabs;
	if (isActive && tabs.length > 1) {
		const fallback = index > 0
			? tabs[index - 1]
			: tabs[index + 1];
		setActiveTab(resourcePanel, fallback.id);
	} else if (isActive && tab.kind === 'code_editor') {
		storeCodeTabContext(tab.context);
	}
	editorTabGroup.removeAt(index);
	if (editorTabGroup.tabs.length === 0) {
		initializeTabs(retainEntryTabContext(sources));
	}
}

export function cycleTab(resourcePanel: ResourcePanelController, direction: number): void {
	const tabs = editorTabGroup.tabs;
	if (tabs.length <= 1 || direction === 0) {
		return;
	}
	const count = tabs.length;
	const currentIndex = editorTabGroup.indexOf(editorTabGroup.activeTab);
	let nextIndex = currentIndex + direction;
	nextIndex = ((nextIndex % count) + count) % count;
	if (nextIndex === currentIndex) {
		return;
	}
	const target = tabs[nextIndex];
	setActiveTab(resourcePanel, target.id);
}

export function isActive(): boolean {
	return editorRuntimeState.active;
}

export function closeActiveTab(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
): void {
	closeTab(resourcePanel, sources, editorTabGroup.activeTab.id);
}
