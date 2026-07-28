import { isResourceViewActive } from '../../workbench/ui/tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import type { PointerSnapshot } from '../../common/models';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { stopPointerSelectionAndResetClicks } from './state';
import type { CartEditor } from '../../cart_editor';

export function handleEditorPointerGuards(
	editor: CartEditor,
	snapshot: PointerSnapshot,
	justPressed: boolean,
): boolean {
	if (isResourceViewActive()) {
		stopPointerSelectionAndResetClicks(snapshot);
		clearHoverTooltip();
		clearGotoHoverHighlight();
		return true;
	}
	if (!hasBlockingWorkbenchModal()) {
		return false;
	}
	if (justPressed) {
		handleBlockingWorkbenchModalPointer(
			editor,
			snapshot,
		);
	}
	stopPointerSelectionAndResetClicks(snapshot);
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
