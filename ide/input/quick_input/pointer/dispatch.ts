import type { CartEditor } from '../../../cart_editor';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { PointerSnapshot } from '../../../common/models';
import { handleCreateResourcePointer } from '../create_resource/pointer';
import { handleResourceSearchPointer } from '../resource_search/pointer';
import { handleSymbolSearchPointer } from '../symbol_search/pointer';
import { handleRenamePointer } from '../rename/pointer';
import { handleLineJumpPointer } from '../line_jump/pointer';
import { handleSearchPointer } from '../search/pointer';

export function handleQuickInputPointer(
	editor: CartEditor,
	sources: RuntimeSourceState,
	snapshot: PointerSnapshot,
	justPressed: boolean,
): boolean {
	const resourcePanel = editor.resourcePanel;
	if (handleCreateResourcePointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleResourceSearchPointer(editor, resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleSymbolSearchPointer(resourcePanel, editor, sources, snapshot, justPressed)) {
		return true;
	}
	if (handleRenamePointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	if (handleLineJumpPointer(resourcePanel, snapshot, justPressed)) {
		return true;
	}
	return handleSearchPointer(sources, resourcePanel, snapshot, justPressed);
}
