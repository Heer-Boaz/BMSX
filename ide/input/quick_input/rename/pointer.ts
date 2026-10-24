import { getRenameFieldLayout } from '../../../workbench/contrib/code_editor/inline_bar/layout';
import { InlineBarFieldPointer } from '../pointer/field';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { getRenameBarBounds } from '../../../workbench/common/layout';
import { renameController } from '../../../workbench/contrib/code_editor/rename/controller';
import type { PointerSnapshot } from '../../../common/models';
import { activateQuickInputField } from '../pointer/common';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

const fieldPointer = new InlineBarFieldPointer(renameController.getField(), getRenameFieldLayout);

export function handleRenamePointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getRenameBarBounds();
	if (!renameController.isVisible() || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			renameController.cancel();
		}
		return false;
	}
	if (justPressed) {
		activateQuickInputField(resourcePanel);
	}
	fieldPointer.handlePointer(snapshot, justPressed);
	return true;
}
