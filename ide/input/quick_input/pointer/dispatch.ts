import type { PointerSnapshot } from '../../../common/models';
import type { EditorSearchController } from '../../../workbench/contrib/code_editor/find/search';
import type { CodeEditorLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';
import type { RenameController } from '../../../workbench/contrib/code_editor/rename/controller';
import type { SourceInlineBars } from '../../../workbench/contrib/code_editor/inline_bar/source_inline_bars';
import { handleRenamePointer } from '../rename/pointer';
import { handleLineJumpPointer } from '../line_jump/pointer';
import { handleSearchPointer } from '../search/pointer';

export function handleQuickInputPointer(find: EditorSearchController, rename: RenameController,
	lineJump: CodeEditorLineJump, bars: SourceInlineBars,
	snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleRenamePointer(rename, bars, snapshot, justPressed)
		|| handleLineJumpPointer(lineJump, bars, snapshot, justPressed)
		|| handleSearchPointer(find, bars, snapshot, justPressed);
}
