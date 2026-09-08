import { clearGotoHoverHighlight } from '../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../editor/contrib/hover/controller';
import type { PointerSnapshot } from '../../common/models';

export function handleInvalidEditorPointerSnapshot(snapshot: PointerSnapshot): boolean {
	if (snapshot.valid) {
		return false;
	}
	clearHoverTooltip();
	clearGotoHoverHighlight();
	return true;
}
