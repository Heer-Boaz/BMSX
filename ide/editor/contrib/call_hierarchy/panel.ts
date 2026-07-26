import type { CallHierarchyView } from './view';
import { closeSymbolSearch } from '../symbols/shared';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

export function showCallHierarchyView(resourcePanel: ResourcePanelController, view: CallHierarchyView): void {
	closeSymbolSearch(false);
	resourcePanel.showCallHierarchy(view);
}
