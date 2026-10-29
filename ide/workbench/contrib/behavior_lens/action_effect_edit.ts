import { resourceIdentityEquals } from '../../../common/resource';
import { indexActionEffectWrites, type EffectPropertyWrite } from './action_effect_index';
import type { LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { BehaviorLensInput } from './editor_input';
import type { BehaviorLensViewState } from './view_model';
import { behaviorSourceEditState, captureBehaviorSourceBookmark, copyBehaviorSourceBookmark } from './source_bookmark';
import { mapTextOffset } from '../../../editor/text/text_change';

/** Retained source field, not a resolved runtime value or a referenced initializer. */
export function selectedActionEffectProperty(view: BehaviorLensViewState): EffectPropertyWrite | undefined {
	if (!view.source.isCurrent || !view.document.syntaxComplete || view.presentation.kind !== 'properties') return undefined;
	const selected = view.selectionState.selected;
	if (selected?.kind !== 'node') return undefined;
	const definition = view.selectionState.definitionRowKey === null ? undefined : view.source.definitionsByRowKey.get(view.selectionState.definitionRowKey);
	return definition?.behaviorKind === 'action_effect' ? indexActionEffectWrites(definition).get(selected.rowKey) : undefined;
}

/** Replace the actual written expression and associate its authored selection with source history. */
export function applyActionEffectPropertyEdit(input: BehaviorLensInput, write: EffectPropertyWrite, value: LuaFieldValueEdit): void {
	const model = input.view.source.models.get(write.file.file)!;
	const selectedRange = write.sourceSelection === 'field' ? value.fieldRange : value.expressionRange;
	const before = captureBehaviorSourceBookmark(input.view, input.view.selectionState.selected!);
	const after = copyBehaviorSourceBookmark(before);
	const originIntent = input.view.selectionState.selectionRevision;
	model.pushEditOperations([value.edit], behaviorSourceEditState.of({ bookmark: before, originIntent }, input.view.editSource), changes => {
		// Explicit replacement selects the new expression; ordinary text markers
		// deliberately collapse when their original source occurrence disappears.
		for (const step of after.path) if (resourceIdentityEquals(step.resource, model.resource)) {
			step.start = mapTextOffset(step.start, changes, 1);
			step.end = mapTextOffset(step.end, changes, -1);
		}
		Object.assign(after.path[after.path.length - 1], luaSourceRangeToTextRange(model.buffer, selectedRange));
		return behaviorSourceEditState.of({ bookmark: after, originIntent }, input.view.editSource);
	});
}
