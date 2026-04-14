import { resourcePanel } from '../../../workbench/contrib/resources/resource_panel_controller';
import type { CallHierarchyView } from './call_hierarchy_view';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';

export function showCallHierarchyView(view: CallHierarchyView): void {
	closeSymbolSearch(false);
	resourcePanel.showCallHierarchy(view);
}
