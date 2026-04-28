import type { CallHierarchyView } from './view';
import { closeSymbolSearch } from '../symbols/shared';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function showCallHierarchyView(runtime: Runtime, view: CallHierarchyView): void {
	closeSymbolSearch(false);
	runtime.editor.resourcePanel.showCallHierarchy(view);
}
