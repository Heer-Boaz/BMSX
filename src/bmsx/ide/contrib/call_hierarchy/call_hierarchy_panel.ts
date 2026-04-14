import { ide_state } from '../../core/ide_state';
import type { CallHierarchyView } from './call_hierarchy_view';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';

export function showCallHierarchyView(view: CallHierarchyView): void {
	closeSymbolSearch(false);
	ide_state.resourcePanel.showCallHierarchy(view);
}
