import { point_in_rect } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import type { PointerSnapshot } from '../../../common/models';
import type { WorkbenchActionBarState } from '../../ui/action_bar';

export function updateWorkbenchActionBarPointer(
	state: WorkbenchActionBarState,
	snapshot: PointerSnapshot,
): EditorCommandId | null {
	for (let index = 0; index < state.items.length; index += 1) {
		const item = state.items[index];
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, item.bounds)) {
			state.hoveredCommand = item.command;
			return item.command;
		}
	}
	state.hoveredCommand = null;
	return null;
}
