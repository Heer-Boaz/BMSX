import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { RenameController } from '../../../workbench/contrib/code_editor/rename/controller';
import type { SourceInlineBars } from '../../../workbench/contrib/code_editor/inline_bar/source_inline_bars';
import type { PointerSnapshot } from '../../../common/models';

export function handleRenamePointer(rename: RenameController, bars: SourceInlineBars,
	snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = bars.renameBounds;
	if (!rename.isVisible() || bounds === null) return false;
	if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) {
		if (justPressed) rename.cancel();
		return false;
	}
	rename.fieldPointer.handlePointer(snapshot, justPressed);
	return true;
}
