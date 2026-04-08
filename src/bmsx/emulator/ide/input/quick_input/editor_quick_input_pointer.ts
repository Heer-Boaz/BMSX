import type { PointerSnapshot } from '../../types';
import { handleCreateResourcePointer } from './editor_create_resource_pointer';
import { handleResourceSearchPointer } from './editor_resource_search_pointer';
import { handleSymbolSearchPointer } from './editor_symbol_search_pointer';
import { handleRenamePointer } from './editor_rename_pointer';
import { handleLineJumpPointer } from './editor_line_jump_pointer';
import { handleSearchPointer } from './editor_search_pointer';

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
