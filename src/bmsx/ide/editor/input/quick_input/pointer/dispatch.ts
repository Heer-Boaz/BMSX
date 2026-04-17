import type { PointerSnapshot } from '../../../../common/models';
import { handleCreateResourcePointer } from '../create_resource/pointer';
import { handleResourceSearchPointer } from '../resource_search/pointer';
import { handleSymbolSearchPointer } from '../symbol_search/pointer';
import { handleRenamePointer } from '../rename/pointer';
import { handleLineJumpPointer } from '../line_jump/pointer';
import { handleSearchPointer } from '../search/pointer';

export function handleQuickInputPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	if (handleCreateResourcePointer(snapshot, justPressed)) {
		return true;
	}
	if (handleResourceSearchPointer(snapshot, justPressed)) {
		return true;
	}
	if (handleSymbolSearchPointer(snapshot, justPressed)) {
		return true;
	}
	if (handleRenamePointer(snapshot, justPressed)) {
		return true;
	}
	if (handleLineJumpPointer(snapshot, justPressed)) {
		return true;
	}
	return handleSearchPointer(snapshot, justPressed);
}
