import type { EditorPaneSelection } from '../services/editor/editor_selection';
// disable cross_layer_import_pattern -- workbench tabs own editor/resource tab activation lifecycle.
import { editorRuntimeState } from '../../editor/common/runtime_state';
import { editorChromeState } from './chrome_state';
import type { EditorTabId } from './tab/id';
import type { EditorInput, EditorInputKind } from './tab/model';
import type { CodeTabContext } from './code_tab/model';
import { beginNavigationCapture, captureNavigation, completeNavigation } from '../../navigation/navigation_history';
import { closeSymbolSearch } from '../contrib/code_editor/symbols/shared';
import {
	createCodeEditorInput,
	retainEntryTabContext,
} from './code_tab/contexts';
import type { EditorTextSelection } from '../../editor/navigation/text_selection';
import { endTabDrag } from './tab/drag';
import type { RuntimeSourceState } from '../../runtime/sources';
import { editorTabGroup, type EditorOpenOptions } from './tab/group_model';
import type { EditorPanes } from '../services/editor/editor_panes';

export function initializeTabs(initialContext: CodeTabContext, editorPanes: EditorPanes): void {
	editorPanes.clearEditor();
	editorChromeState.tabHoverId = null;
	editorChromeState.lastTabClickId = null;
	editorChromeState.tabScrollControl.cancelPointer();
	editorChromeState.tabScrollbar.setScroll(0);
	editorChromeState.tabButtonBounds.clear();
	editorChromeState.tabCloseButtonBounds.clear();
	const initialTab = createCodeEditorInput(initialContext);
	editorTabGroup.initialize(initialTab);
	editorPanes.openEditor(initialTab);
}

export function getActiveTabKind(): EditorInputKind {
	return editorTabGroup.activeTab.kind;
}

export function getActiveTab(): EditorInput {
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

export function isScenarioLabActive(): boolean {
	return getActiveTabKind() === 'scenario_lab';
}

/** Opening is distinct from activation: only an explicit preview can replace a tab. */
export function openEditorTab(editorPanes: EditorPanes, input: EditorInput, options: EditorOpenOptions = {}): void {
	captureNavigation(() => {
		if (editorTabGroup.indexOf(input) === -1) {
			// Focus/capture must end while the previous input is still alive.
			editorPanes.clearEditor();
			editorTabGroup.add(input, options);
		} else if (options.pinned !== false) editorTabGroup.pin(input);
		setActiveTab(editorPanes, input.id);
	});
}

export function setActiveTab(
	editorPanes: EditorPanes,
	tabId: EditorTabId,
	selection?: EditorTextSelection,
	navigationSelection?: EditorPaneSelection,
): void {
	const tab = editorTabGroup.findById(tabId)!;
	const activeTab = editorTabGroup.activeTab;
	const isSameTab = activeTab === tab;
	const navigationCheckpoint = (!isSameTab || selection || navigationSelection)
		? beginNavigationCapture()
		: null;
	closeSymbolSearch(true);
	if (isSameTab) {
		editorTabGroup.activate(tab);
		editorPanes.openEditor(tab, selection, navigationSelection);
		if (!isSameTab || selection || navigationSelection) {
			completeNavigation(navigationCheckpoint);
		}
		return;
	}
	// End the old control's input while its resource and view are still attached.
	editorPanes.clearEditor();
	editorTabGroup.activate(tab);
	editorPanes.openEditor(tab, selection, navigationSelection);
	if (!isSameTab || selection || navigationSelection) {
		completeNavigation(navigationCheckpoint);
	}
}

export function activateCodeTab(editorPanes: EditorPanes): void {
	const tabs = editorTabGroup.tabs;
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		if (tab.kind === 'code_editor') {
			setActiveTab(editorPanes, tab.id);
			return;
		}
	}
}

export function getTabs(): readonly EditorInput[] {
	return editorTabGroup.tabs;
}

export function getActiveTabId(): EditorTabId {
	return editorTabGroup.activeTab.id;
}

export function findTabById(tabId: EditorTabId): EditorInput | undefined {
	return editorTabGroup.findById(tabId);
}

export function isTabActive(tabId: EditorTabId): boolean {
	return editorTabGroup.activeTab.id === tabId;
}

export function closeTab(
	editorPanes: EditorPanes,
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
		setActiveTab(editorPanes, fallback.id);
	} else if (isActive) editorPanes.clearEditor();
	editorTabGroup.removeAt(index);
	if (editorTabGroup.tabs.length === 0) {
		initializeTabs(retainEntryTabContext(sources), editorPanes);
	}
}

export function cycleTab(editorPanes: EditorPanes, direction: number): void {
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
	setActiveTab(editorPanes, target.id);
}

export function isActive(): boolean {
	return editorRuntimeState.active;
}

export function closeActiveTab(
	editorPanes: EditorPanes,
	sources: RuntimeSourceState,
): void {
	closeTab(editorPanes, sources, editorTabGroup.activeTab.id);
}
