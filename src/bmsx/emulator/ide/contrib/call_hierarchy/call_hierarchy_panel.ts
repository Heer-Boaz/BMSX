import { ide_state } from '../../ide_state';
import type { CallHierarchyView } from './call_hierarchy_view';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';

export function showCallHierarchyView(view: CallHierarchyView): void {
	closeSymbolSearch(false);
	ide_state.resourcePanel.showCallHierarchy(view);
	const panelState = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelFocused = panelState.focused;
	ide_state.resourceBrowserSelectionIndex = panelState.selectionIndex;
	ide_state.resourcePanelVisible = panelState.visible;
}
