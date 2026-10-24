import { getLineJumpFieldLayout } from '../../../workbench/contrib/code_editor/inline_bar/layout';
import { InlineBarFieldPointer } from '../pointer/field';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { getLineJumpBarBounds } from '../../../workbench/common/layout';
import type { PointerSnapshot } from '../../../common/models';
import { activateQuickInputField } from '../pointer/common';
import { lineJumpState } from '../../../workbench/contrib/code_editor/find/widget_state';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

const fieldPointer = new InlineBarFieldPointer(lineJumpState.field, getLineJumpFieldLayout);

export function handleLineJumpPointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getLineJumpBarBounds();
	if (!lineJumpState.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			lineJumpState.field.focusTarget.release();
		}
		return false;
	}
	if (justPressed) {
		lineJumpState.field.focusTarget.focus();
		activateQuickInputField(resourcePanel);
	}
	fieldPointer.handlePointer(snapshot, justPressed);
	return true;
}
