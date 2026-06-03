import { isResourceViewActive } from '../../workbench/ui/tabs';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import type { PointerSnapshot } from '../../common/models';
import type { Runtime } from '../../../machine/runtime/runtime';
import { handleBlockingWorkbenchModalPointer, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { stopPointerSelectionAndResetClicks } from './state';

export function handleEditorPointerGuards(runtime: Runtime, snapshot: PointerSnapshot, justPressed: boolean): boolean {
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
		handleBlockingWorkbenchModalPointer(runtime, snapshot);
	}
	stopPointerSelectionAndResetClicks(snapshot);
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
