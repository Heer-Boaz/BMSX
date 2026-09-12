import type { EditorTextModel } from '../../../editor/model/text_model';
import { createLuaStringValueEdit } from '../../../language/lua/source_edits';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, copyBehaviorSourceBookmark, mapBehaviorSourceBookmark } from './source_bookmark';
import type { StateMachineRetargetCheck } from './state_machine_retarget';
import type { StateMachineSourceSelection } from './state_machine_selection';
import type { BehaviorLensViewState } from './view_model';

/** Apply admitted current-source evidence, not rendered endpoints or a runtime mutation. */
export function retargetStateMachineTransition(
	model: EditorTextModel, view: BehaviorLensViewState,
	selection: Extract<StateMachineSourceSelection, { kind: 'state-outcome' }>,
	target: Extract<StateMachineRetargetCheck, { kind: 'available' }>,
): void {
	const before = captureBehaviorSourceBookmark(view, selection);
	const after = copyBehaviorSourceBookmark(before);
	const edit = createLuaStringValueEdit(model.buffer, target.literal, target.text);
	model.pushEditOperations([edit], behaviorSourceEditState.of(before), changes => {
		mapBehaviorSourceBookmark(after, model.resource, changes);
		if (after.tracked.kind === 'direct') {
			// This command replaces precisely the selected binding token. Ordinary
			// deletion tracking must still collapse it, so publish explicit new syntax.
			after.tracked.binding.start = edit.offset;
			after.tracked.binding.end = edit.offset + edit.text.length;
		}
		return behaviorSourceEditState.of(after);
	});
}
