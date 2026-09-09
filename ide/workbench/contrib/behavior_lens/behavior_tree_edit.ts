import type { BehaviorTreeSourceMember } from './behavior_tree_model';
import type { BehaviorLensViewState } from './view_model';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { createLuaTableFieldMoveEdits } from '../../../language/lua/table_field_moves';

/** Constant-time command admission from the current projection's source evidence. */
export function behaviorTreeMoveTarget(view: BehaviorLensViewState, direction: -1 | 1): BehaviorTreeSourceMember | undefined {
	if (!view.document.syntaxComplete || view.presentation.kind !== 'graph') return undefined;
	const selection = view.presentation.viewport.selection;
	if (selection === null) return undefined;
	const member = (selection.kind === 'node' ? selection : selection.child).member;
	if (member !== null && member.index + direction >= 0 && member.index + direction < member.entries.length) return member;
	return undefined;
}

/** Array ranks are not lexical field indices: named metadata stays ordinary Lua. */
export function moveBehaviorTreeChild(model: EditorTextModel, member: BehaviorTreeSourceMember, destination: number): void {
	const fields = member.table.fields;
	model.pushEditOperations(createLuaTableFieldMoveEdits(model.buffer, model.resource.path, member.table,
		fields.indexOf(member.entries[member.index].field), fields.indexOf(member.entries[destination].field)));
}
