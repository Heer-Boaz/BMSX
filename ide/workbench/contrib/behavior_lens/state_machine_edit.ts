import type { EditorModelEdit, EditorTextModel } from '../../../editor/model/text_model';
import { createLuaStringValueEdit } from '../../../language/lua/source_edits';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, copyBehaviorSourceBookmark, mapBehaviorSourceBookmark } from './source_bookmark';
import type { StateMachineRetargetCheck } from './state_machine_retarget';
import type { StateMachineSourceSelection } from './state_machine_selection';
import type { BehaviorLensViewState } from './view_model';

/** Exact literal operations and typed history state, captured before review or navigation. */
export function createStateMachineRetargetEdit(
	model: EditorTextModel, view: BehaviorLensViewState,
	selection: Extract<StateMachineSourceSelection, { kind: 'state-outcome' }>,
	target: Extract<StateMachineRetargetCheck, { kind: 'available' }>,
): EditorModelEdit {
	const before = captureBehaviorSourceBookmark(view, selection);
	const after = copyBehaviorSourceBookmark(before);
	const edit = createLuaStringValueEdit(model.buffer, target.file.chunk.locations, target.literal, target.text);
	const resource = model.identity, bindingStart = edit.offset, bindingEnd = edit.offset + edit.text.length;
	const originIntent = view.selectionState.selectionRevision;
	return { version: model.version, edits: [edit], beforeEditState: behaviorSourceEditState.of({ bookmark: before, originIntent }, view.editSource), computeAfterEditState: changes => {
		mapBehaviorSourceBookmark(after, resource, changes);
		if (after.tracked.kind === 'direct') {
			// This command replaces precisely the selected binding token. Ordinary
			// deletion tracking must still collapse it, so publish explicit new syntax.
			after.tracked.binding.start = bindingStart;
			after.tracked.binding.end = bindingEnd;
		}
		return behaviorSourceEditState.of({ bookmark: after, originIntent }, view.editSource);
	} };
}
