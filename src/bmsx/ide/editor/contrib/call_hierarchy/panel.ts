import { resourcePanel } from '../../../workbench/contrib/resources/panel/controller';
import type { CallHierarchyView } from './view';
import { closeSymbolSearch } from '../symbols/shared';

export function showCallHierarchyView(view: CallHierarchyView): void {
	closeSymbolSearch(false);
	resourcePanel.showCallHierarchy(view);
}
