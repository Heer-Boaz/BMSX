import { machineManager } from '../../../../core/machine_manager';
import type { CallHierarchyView } from './view';
import { closeSymbolSearch } from '../symbols/shared';

export function showCallHierarchyView(view: CallHierarchyView): void {
	closeSymbolSearch(false);
	machineManager.ideState.editor.resourcePanel.showCallHierarchy(view);
}
