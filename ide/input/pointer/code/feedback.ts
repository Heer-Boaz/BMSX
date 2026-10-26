import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import type { CodeEditorHoverController } from '../../../editor/contrib/hover/controller';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { refreshGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { resolvePointerTextPosition, type CodeAreaBounds } from '../../../editor/ui/view/view';
import type { PointerInputSnapshot } from '../../../common/models';
import { isAltDown } from '../../keyboard/key_input';

export function updateCodeAreaPointerFeedback(code: CodeEditorControl, hover: CodeEditorHoverController,
	sources: RuntimeSourceState, snapshot: PointerInputSnapshot, inside: boolean, goto: boolean,
	selecting: boolean, bounds: CodeAreaBounds): void {
	const idle = (snapshot.pressedButtons & PointerButton.Primary) === 0 && !selecting && inside;
	if (idle && goto) {
		const point = resolvePointerTextPosition(code, snapshot.viewportX, snapshot.viewportY, bounds);
		if (point.injected) code.gotoHoverHighlight = null;
		else refreshGotoHoverHighlight(code, sources, point.row, point.column);
	} else code.gotoHoverHighlight = null;
	if (idle && isAltDown(snapshot)) {
		const point = resolvePointerTextPosition(code, snapshot.viewportX, snapshot.viewportY, bounds);
		if (point.injected) hover.clear(); else hover.update(point.row, point.column);
	} else hover.clear();
}
