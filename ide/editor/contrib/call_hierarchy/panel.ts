import { runtimeWorkbenchState } from '../../../runtime/workbench_state';
import type { CallHierarchyView } from './view';
import { closeSymbolSearch } from '../symbols/shared';

export function showCallHierarchyView(view: CallHierarchyView): void {
	closeSymbolSearch(false);
	runtimeWorkbenchState.ide.editor.resourcePanel.showCallHierarchy(view);
}
