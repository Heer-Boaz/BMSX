import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../../common/models';
import type { CodeEditorLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';
import type { SourceInlineBars } from '../../../workbench/contrib/code_editor/inline_bar/source_inline_bars';

export function handleLineJumpPointer(lineJump: CodeEditorLineJump, bars: SourceInlineBars,
	snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = bars.lineJumpBounds;
	if (!lineJump.state.visible || bounds === null) return false;
	if (!point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) {
		if (justPressed) lineJump.state.field.focusTarget.release();
		return false;
	}
	if (justPressed) {
		lineJump.focus();
	}
	lineJump.fieldPointer.handlePointer(snapshot, justPressed);
	return true;
}
