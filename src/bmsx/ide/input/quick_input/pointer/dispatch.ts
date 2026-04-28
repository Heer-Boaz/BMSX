import type { PointerSnapshot } from '../../../common/models';
import type { Runtime } from '../../../../machine/runtime/runtime';
import { handleCreateResourcePointer } from '../create_resource/pointer';
import { handleResourceSearchPointer } from '../resource_search/pointer';
import { handleSymbolSearchPointer } from '../symbol_search/pointer';
import { handleRenamePointer } from '../rename/pointer';
import { handleLineJumpPointer } from '../line_jump/pointer';
import { handleSearchPointer } from '../search/pointer';

export function handleQuickInputPointer(runtime: Runtime, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const resourcePanel = runtime.editor.resourcePanel;
	if (handleCreateResourcePointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleResourceSearchPointer(runtime, snapshot, justPressed)) {
		return true;
	}
	if (handleSymbolSearchPointer(runtime, snapshot, justPressed)) {
		return true;
	}
	if (handleRenamePointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleLineJumpPointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	return handleSearchPointer(runtime, snapshot, justPressed);
}
